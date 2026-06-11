"use strict";

/**
 * domain_tools.js — Tools que exponen las rutas de negocio al LLM.
 *
 * Con esto el modelo puede llamar directamente `domain.get_prices`,
 * `domain.get_weather`, etc. sin necesitar un clasificador previo ni un
 * switch de intenciones. El LLM actúa como router; la lógica de negocio
 * (las rutas) permanece intacta e idéntica.
 *
 * Cargado desde tools/index.js (efecto lateral al importar).
 * Activadas en el pipeline con AGENT_TOOL_FIRST_MODE=1.
 */

const { registerTool } = require("./registry");

// ---------------------------------------------------------------------------
// domain.get_prices — Precios de granos, hacienda, insumos o dólar
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_prices",
  description:
    "Obtiene precios actuales de mercado para el productor. " +
    "Usá esta tool cuando el productor pregunte por cotizaciones, precios o valores de: " +
    "granos (soja, maíz, trigo, girasol, cebada, sorgo, papa), " +
    "hacienda (novillo, vaca, vaquillona, ternero, invernada), " +
    "insumos (semillas, agroquímicos, fertilizantes) o " +
    "tipo de cambio (dólar oficial, blue).",
  parameters: {
    type: "object",
    properties: {
      cultivo: {
        type: "string",
        description:
          "Nombre del grano si aplica. Ej: soja, maiz, trigo, girasol, cebada, sorgo, papa. " +
          "Null si es hacienda, insumos o dólar.",
      },
      variante: {
        type: "string",
        enum: ["hacienda", "insumos", "dolar", "dolar_blue"],
        description:
          "Tipo especial cuando no es un grano. " +
          "'hacienda' para bovinos, 'insumos' para insumos agro, 'dolar'/'dolar_blue' para tipo de cambio.",
      },
      mercado: {
        type: "string",
        description: "Mercado específico si el productor lo menciona: rosario, ba, cac. Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { rutaPrecio } = require("../../rutas/precio");
    const patch = { intencion: "precio", confianza: "alta" };
    if (args.cultivo) patch.cultivo = String(args.cultivo).toLowerCase().trim();
    if (args.variante === "dolar" || args.variante === "dolar_blue") {
      patch.variante_precio = "dolar";
    } else if (args.variante === "hacienda") {
      patch.producto = "hacienda";
    } else if (args.variante === "insumos") {
      patch.producto = "insumos";
    }
    const clasificacion = { ...(ctx.clasificacion || {}), ...patch };
    const texto = await rutaPrecio({
      clasificacion,
      mensaje: String(ctx.mensaje || "").trim(),
      usuario: ctx.usuario || null,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.get_weather — Clima y alertas para la zona del productor
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_weather",
  description:
    "Obtiene el pronóstico del tiempo y alertas climáticas para la zona del productor. " +
    "Usá esta tool cuando el productor pregunte por lluvia, temperatura, viento, heladas, " +
    "granizo, pronóstico, condiciones climáticas o alertas del INTA/SMN.",
  parameters: {
    type: "object",
    properties: {
      zona: {
        type: "string",
        description:
          "Zona o localidad si el productor la menciona explícitamente. " +
          "Si no la menciona, se usa la zona de su perfil. Opcional.",
      },
      periodo: {
        type: "string",
        enum: ["hoy", "manana", "pasado_manana", "fin_de_semana", "semana", "todos"],
        description: "El período de tiempo consultado para el pronóstico: 'hoy', 'manana', 'pasado_manana', 'fin_de_semana' (sábado y domingo), 'semana' (los 7 días) o 'todos' (7 días). Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { rutaClima } = require("../../rutas/clima");
    // Si el usuario menciona una zona distinta a la de su perfil, la inyectamos al mensaje
    const mensaje = args.zona
      ? `${String(ctx.mensaje || "").trim()} (zona: ${args.zona})`
      : String(ctx.mensaje || "").trim();
    const texto = await rutaClima({
      clasificacion: { ...(ctx.clasificacion || {}), intencion: "clima", confianza: "alta" },
      mensaje,
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
      periodo: args.periodo || null,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.register_movement — Registrar venta, gasto o movimiento de inventario
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.register_movement",
  description:
    "Registra un movimiento o evento en el campo del productor: venta de granos/hacienda, " +
    "gasto/compra (insumos, combustible, mano de obra, etc.), movimiento de inventario/stock, " +
    "o registro de animales individuales (trazabilidad, caravanas, raza, peso, sexo, observaciones, eventos de salud). " +
    "SOLO usá esta tool cuando el productor PROVEE datos concretos en el mensaje: " +
    "cantidad + categoría (ej: '120 novillos en lote Norte'), " +
    "monto + concepto (ej: 'gasté 50000 en semilla'), " +
    "o datos de un animal individual (ej: 'quiero registrar 1 ternero caravana AR-105 de raza Aberdeen Angus, peso 180 kilos y sexo macho en el lote Bajo Grande', " +
    "'tengo 1 vaca caravana AR-106 de raza Hereford preñada', 'registrale una observacion a la caravana AR-105 que dice...'). " +
    "NO usés esta tool para preguntas sobre capacidades del sistema, aunque mencionen animales o lotes. " +
    "Contraejemplos que NO deben llamar esta tool: " +
    "'¿Puedo registrar los cerdos en cinco chiqueros?' (→ domain.agro_general), " +
    "'¿Puedo cargar varios lotes?' (→ domain.agro_general), " +
    "'¿Se puede identificar cada animal?' (→ domain.agro_general).",
  parameters: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["venta", "gasto", "inventario"],
        description: "Tipo de movimiento detectado. Elegí el que mejor corresponda al mensaje.",
      },
    },
    required: ["tipo"],
  },
  execute: async (ctx, args) => {
    const { clasificarHeuristica } = require("../../clasificador");
    const cl = clasificarHeuristica(ctx.mensaje);

    if (cl.intencion === "registrar_pastura") {
      const { rutaPasturas } = require("../../rutas/pasturas");
      const texto = await rutaPasturas({
        clasificacion: { ...cl, confianza: "alta" },
        mensaje: String(ctx.mensaje || "").trim(),
        usuario: ctx.usuario || null,
        numeroWhatsapp: ctx.numeroWhatsapp,
      });
      return { texto: String(texto || "").trim() };
    }

    const { rutaRegistrar } = require("../../rutas/registrar");
    const clasificacion = {
      ...(ctx.clasificacion || {}),
      intencion: "registrar",
      confianza: "alta",
    };
    const texto = await rutaRegistrar({
      clasificacion,
      mensaje: String(ctx.mensaje || "").trim(),
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.get_records — Consultar registros, inventario o finanzas del productor
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_records",
  description:
    "Consulta los registros propios del productor: gastos, ventas, margen, " +
    "inventario de stock, lotes. Usá esta tool cuando el productor pregunta por " +
    "sus datos cargados: «¿qué tengo?», «mis gastos», «mis ventas», «¿cuánto tengo en inventario?», " +
    "«mi margen», «mis lotes», «¿cómo vengo?».",
  parameters: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["gastos", "ventas", "margen", "inventario", "lotes", "todo"],
        description:
          "Sección específica a consultar si el productor la menciona. " +
          "Usá 'todo' si no está claro o si pide un resumen general.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { rutaConsultaRegistros } = require("../../rutas/consulta_registros");
    const clasificacion = {
      ...(ctx.clasificacion || {}),
      intencion: "consulta_registros",
      confianza: "alta",
    };
    // Enriquecemos el mensaje con el tipo si el LLM lo detectó
    const tipo = String(args.tipo || "").trim();
    const mensajeEnriquecido =
      tipo && tipo !== "todo"
        ? `${String(ctx.mensaje || "").trim()} (consulta: ${tipo})`
        : String(ctx.mensaje || "").trim();
    const texto = await rutaConsultaRegistros({
      clasificacion,
      mensaje: mensajeEnriquecido,
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.market_analysis — Análisis de mercado con noticias y tendencias
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.market_analysis",
  description:
    "Genera un análisis de mercado agropecuario con noticias recientes y perspectivas. " +
    "Usá esta tool cuando el productor pregunte por tendencias, perspectivas, análisis, " +
    "«¿conviene vender?», «¿cómo está el mercado?», noticias del agro, o cualquier pregunta " +
    "que requiera contexto más amplio que el precio puntual.",
  parameters: {
    type: "object",
    properties: {
      cultivo: {
        type: "string",
        description: "Cultivo o producto específico si el productor lo menciona. Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { rutaAnalisisMercado } = require("../../rutas/analisis_mercado");
    const patch = { intencion: "analisis_mercado", confianza: "alta" };
    if (args.cultivo) patch.cultivo = String(args.cultivo).toLowerCase().trim();
    const clasificacion = { ...(ctx.clasificacion || {}), ...patch };
    const texto = await rutaAnalisisMercado({
      clasificacion,
      mensaje: String(ctx.mensaje || "").trim(),
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.my_analysis — Análisis interno basado en datos propios del productor
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.my_analysis",
  description:
    "Análisis personalizado y de valor agregado basado en los datos del propio productor " +
    "(cultivos registrados, hectáreas, costos, finanzas) cruzados con datos externos de mercado. " +
    "Usá esta tool cuando el productor pregunta «¿me conviene vender?», «¿cómo estoy parado?», " +
    "«análisis de mi campaña», o cualquier pregunta que requiera fórmulas agroeconómicas " +
    "(Margen Bruto, Punto de Equilibrio) combinando su información interna con el contexto externo.",
  parameters: {
    type: "object",
    properties: {
      cultivo: {
        type: "string",
        description: "Cultivo específico a analizar si aplica. Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    if (ctx.usuario?.es_delegado) {
      const rol = String(ctx.usuario.rol_operario || "").trim().toLowerCase();
      if (["operario", "tractorista"].includes(rol)) {
        return {
          texto: `⚠️ *Acceso Restringido*\n\nComo integrante de equipo con el rol de *${rol.toUpperCase()}*, no tenés permisos para ejecutar análisis económico-financieros en este establecimiento.`,
        };
      }
    }
    const { rutaAnalisisInterno } = require("../../rutas/analisis_interno");
    const patch = { intencion: "analisis_interno", confianza: "alta" };
    if (args.cultivo) patch.cultivo = String(args.cultivo).toLowerCase().trim();
    const clasificacion = { ...(ctx.clasificacion || {}), ...patch };
    const texto = await rutaAnalisisInterno({
      clasificacion,
      mensaje: String(ctx.mensaje || "").trim(),
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.get_technical_ratios — Ratios insumo-producto y relaciones de intercambio
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_technical_ratios",
  description:
    "Calcula relaciones de intercambio y ratios técnicos (Insumo-Producto, Novillo/Maíz, Ternero/Soja). " +
    "Herramienta de alto valor para ingenieros agrónomos y productores. " +
    "Usá esta tool cuando pregunten por equivalencias, cuántos kg de grano se necesitan para comprar otro activo, " +
    "o la relación histórica/actual entre dos productos del agro.",
  parameters: {
    type: "object",
    properties: {
      activo_a: { type: "string", description: "Primer producto (ej: soja, novillo, ternero)." },
      activo_b: { type: "string", description: "Segundo producto (ej: maiz, glifosato, urea)." },
    },
    required: ["activo_a", "activo_b"],
  },
  execute: async (ctx) => {
    const { responderRelacionIntercambio } = require("../../consultas/relacion");
    const {
      normMin,
      consultaPideDisponibleYMatba,
      tokenPosicionPorMes,
      obtenerFuturoMatbaReferencia,
      obtenerPrecioActivoRelacion,
      formatearMoneda,
      adaptarRespuestaPorNivel,
    } = require("../../consultas/legacy_helpers");

    const texto = await responderRelacionIntercambio(
      { texto: ctx.mensaje, nivel: "TECNICO" },
      {
        normMinFn: normMin,
        consultaPideDisponibleYMatbaFn: consultaPideDisponibleYMatba,
        tokenPosicionPorMesFn: tokenPosicionPorMes,
        obtenerFuturoMatbaReferenciaFn: obtenerFuturoMatbaReferencia,
        obtenerPrecioActivoRelacionFn: obtenerPrecioActivoRelacion,
        formatearMonedaFn: formatearMoneda,
        adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
      }
    );
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.get_market_structure — Carry, Inverso, Basis y TC Implícito
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_market_structure",
  description:
    "Análisis técnico de la estructura de mercado: Carry, Backwardation (Inverso), Basis y Tipo de Cambio Implícito. " +
    "Herramienta profesional para optimizar el timing de venta y cobertura. " +
    "Usá esta tool cuando pregunten si conviene vender hoy o esperar al futuro, " +
    "cómo está el carry, o la relación entre el spot y las posiciones MATBA/ROFEX.",
  parameters: {
    type: "object",
    properties: {
      cultivo: { type: "string", description: "Grano a analizar (ej: soja, maiz, trigo)." },
      incluir_hacienda: {
        type: "boolean",
        description: "Si debe incluir lectura de feedlot/novillo en el análisis. Opcional.",
      },
    },
    required: ["cultivo"],
  },
  execute: async (ctx, args) => {
    const { responderEstructuraMercadoYFeedlot } = require("../../consultas/estructura");
    const {
      normMin,
      adaptarRespuestaPorNivel,
      query,
      toISODateParam,
      formatearMoneda,
      etiquetaTipoCambio,
      obtenerDisponiblePoliticaResumenUnCultivo,
    } = require("../../consultas/legacy_helpers");

    // Enriquecemos el mensaje si pide hacienda
    const mensaje = args.incluir_hacienda ? `${ctx.mensaje} novillo feedlot` : ctx.mensaje;

    const texto = await responderEstructuraMercadoYFeedlot(
      { texto: mensaje, nivel: "TECNICO" },
      {
        normMinFn: normMin,
        adaptarRespuestaPorNivelFn: adaptarRespuestaPorNivel,
        queryFn: query,
        toISODateParamFn: toISODateParam,
        formatearMonedaFn: formatearMoneda,
        etiquetaTipoCambioFn: etiquetaTipoCambio,
        obtenerDisponiblePoliticaResumenUnCultivoFn: obtenerDisponiblePoliticaResumenUnCultivo,
      }
    );
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.run_command — Ejecutar comandos del bot (MI RESUMEN, VER COMANDOS, etc.)
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.run_command",
  description:
    "Ejecuta comandos del bot AgroHabilis. Usá esta tool cuando el productor usa " +
    "comandos en mayúsculas o su equivalente natural: " +
    "MI RESUMEN (resumen diario), VER COMANDOS (lista de comandos), " +
    "MIS ALERTAS (ver alertas activas), MI MARGEN (resumen financiero), " +
    "PLANES / QUIERO PLAN (info de planes), ESTADO (estado del bot), etc.",
  parameters: {
    type: "object",
    properties: {
      comando: {
        type: "string",
        description:
          "Comando detectado. Ej: 'MI RESUMEN', 'VER COMANDOS', 'MIS ALERTAS', 'PLANES'. " +
          "Si el productor lo escribe en lenguaje natural, identificá el comando equivalente.",
      },
    },
    required: ["comando"],
  },
  execute: async (ctx, args) => {
    const cmd = String(args.comando || "").trim().toUpperCase();
    if (ctx.usuario?.es_delegado && ["MI RESUMEN", "MI MARGEN", "MIS GASTOS", "MIS VENTAS"].includes(cmd)) {
      const rol = String(ctx.usuario.rol_operario || "").trim().toLowerCase();
      if (["operario", "tractorista"].includes(rol)) {
        return {
          texto: `⚠️ *Acceso Restringido*\n\nComo integrante de equipo con el rol de *${rol.toUpperCase()}*, no tenés permisos para ejecutar el comando *${cmd}* ni visualizar información financiera del establecimiento.`,
        };
      }
    }
    const { rutaComando } = require("../../rutas/comando");
    const patch = {
      intencion: "comando",
      confianza: "alta",
      comando_detectado: cmd,
    };
    const clasificacion = { ...(ctx.clasificacion || {}), ...patch };
    const texto = await rutaComando({
      clasificacion,
      mensaje: String(ctx.mensaje || "").trim(),
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.agro_general — Respuesta agro general (contexto, dudas, info del sector)
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.agro_general",
  description:
    "Responde consultas agropecuarias generales que no encajan en otra tool: " +
    "dudas técnicas de cultivos, buenas prácticas, normativa, planes del gobierno, " +
    "saludos, preguntas sobre el bot, o cualquier tema agro sin datos numéricos específicos. " +
    "Usá esta tool como último recurso cuando ninguna otra tool aplica mejor.",
  parameters: {
    type: "object",
    properties: {
      tema: {
        type: "string",
        description: "Tema o categoría de la consulta si es posible identificarlo. Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { rutaAgroGeneral } = require("../../rutas/agro_general");
    const patch = { intencion: "agro_general", confianza: "alta" };
    if (args.tema) patch.tema_detectado = String(args.tema).trim();
    const clasificacion = { ...(ctx.clasificacion || {}), ...patch };
    const texto = await rutaAgroGeneral({
      clasificacion,
      mensaje: String(ctx.mensaje || "").trim(),
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.get_animal_history — Consultar historial individual de animales (sanidad, pesajes)
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_animal_history",
  description:
    "Consulta el historial individual de un animal (caravana) o un grupo: " +
    "vacunaciones, pesajes, tratamientos, visitas veterinarias, o estado actual de un animal. " +
    "Usá esta tool cuando el productor pregunte: «¿qué tiene la caravana 123?», " +
    "«¿cuándo se vacunó la 456?», «¿cuál fue el último peso del lote Norte?», " +
    "«ver historial de sanidad de mis animales».",
  parameters: {
    type: "object",
    properties: {
      caravana: {
        type: "string",
        description: "Número o código de caravana del animal si se menciona. Opcional.",
      },
      lote: {
        type: "string",
        description: "Nombre del lote si se menciona para filtrar. Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    const { rutaConsultaSanidad } = require("../../rutas/consulta_sanidad");
    const clasificacion = {
      ...(ctx.clasificacion || {}),
      intencion: "consulta_sanidad",
      confianza: "alta",
    };
    const caravana = String(args.caravana || "").trim();
    const lote = String(args.lote || "").trim();
    let mensajeEnriquecido = String(ctx.mensaje || "").trim();
    if (caravana) mensajeEnriquecido += ` (caravana: ${caravana})`;
    if (lote) mensajeEnriquecido += ` (lote: ${lote})`;

    const texto = await rutaConsultaSanidad({
      clasificacion,
      mensaje: mensajeEnriquecido,
      usuario: ctx.usuario || null,
      numeroWhatsapp: ctx.numeroWhatsapp,
    });
    return { texto: String(texto || "").trim() };
  },
});

// ---------------------------------------------------------------------------
// domain.calculate_ration — Calculadora de Carga Animal y Racionamiento
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.calculate_ration",
  description:
    "Calcula los requerimientos de consumo de Materia Seca (MS) diarios para un lote de ganado " +
    "y la formulación exacta en kg para cargar en el mixer (silaje, maíz, concentrado). " +
    "Usá esta tool cuando el productor o asesor pregunte: " +
    "«calcular ración para 120 novillos de 350 kg», " +
    "«cuánta comida necesita mi hacienda», " +
    "«ración de engorde/feedlot», «formulación del mixer».",
  parameters: {
    type: "object",
    properties: {
      cabezas: {
        type: "integer",
        description: "Cantidad de cabezas de ganado a alimentar. Obligatorio.",
      },
      peso: {
        type: "number",
        description: "Peso vivo promedio por cabeza en kg. Obligatorio.",
      },
      dieta: {
        type: "string",
        enum: ["suplementacion", "feedlot", "pastura"],
        description: "Tipo de ración/dieta (suplementacion, feedlot o pastura). Opcional.",
      },
    },
    required: ["cabezas", "peso"],
  },
  execute: async (ctx, args) => {
    const cabezas = Number(args.cabezas);
    const peso = Number(args.peso);
    const dieta = args.dieta || "suplementacion";

    const consumoPorc = 2.8; // 2.8% base agrónoma
    const msCab = peso * (consumoPorc / 100);
    const msTotal = msCab * cabezas;

    let wetTotal = 0;
    let racionText = "";

    if (dieta === "suplementacion") {
      const silajeMs = msTotal * 0.70;
      const maizMs = msTotal * 0.25;
      const concMs = msTotal * 0.05;

      const silajeWet = silajeMs / 0.35;
      const maizWet = maizMs / 0.85;
      const concWet = concMs / 0.90;
      wetTotal = silajeWet + maizWet + concWet;

      racionText = 
        `🌾 *Suplementación Balanceada* (70% Silaje, 25% Maíz, 5% Concentrado):\n` +
        `  - Silaje de Maíz (35% MS): *${silajeWet.toFixed(0)} kg* (${(silajeWet / cabezas).toFixed(1)} kg/cab)\n` +
        `  - Maíz Molido (85% MS): *${maizWet.toFixed(0)} kg* (${(maizWet / cabezas).toFixed(1)} kg/cab)\n` +
        `  - Concentrado (90% MS): *${concWet.toFixed(0)} kg* (${(concWet / cabezas).toFixed(1)} kg/cab)`;
    } else if (dieta === "feedlot") {
      const maizMs = msTotal * 0.60;
      const silajeMs = msTotal * 0.35;
      const nucleoMs = msTotal * 0.05;

      const maizWet = maizMs / 0.85;
      const silajeWet = silajeMs / 0.35;
      const nucleoWet = nucleoMs / 0.90;
      wetTotal = maizWet + silajeWet + nucleoWet;

      racionText = 
        `🌽 *Feedlot / Engorde Intensivo* (60% Maíz, 35% Silaje, 5% Núcleo):\n` +
        `  - Maíz Molido (85% MS): *${maizWet.toFixed(0)} kg* (${(maizWet / cabezas).toFixed(1)} kg/cab)\n` +
        `  - Silaje de Planta (35% MS): *${silajeWet.toFixed(0)} kg* (${(silajeWet / cabezas).toFixed(1)} kg/cab)\n` +
        `  - Núcleo Invernada (90% MS): *${nucleoWet.toFixed(0)} kg* (${(nucleoWet / cabezas).toFixed(1)} kg/cab)`;
    } else {
      const forrajeWet = msTotal / 0.20;
      wetTotal = forrajeWet;

      racionText = 
        `🌿 *Pastura Base / Consumo Directo* (100% Forraje Verde):\n` +
        `  - Pasto Fresco (~20% MS): *${forrajeWet.toFixed(0)} kg/día* (${(forrajeWet / cabezas).toFixed(1)} kg/cab)`;
    }

    const response = 
      `🧮 *CÁLCULO AGRO-TECNOLÓGICO DE RACIONAMIENTO*\n` +
      `━\n` +
      `• *Categoría/Establecimiento*: ${cabezas} cabezas de ${peso} kg promedio.\n` +
      `• *Consumo Diario de Materia Seca (MS)*: *${msCab.toFixed(2)} kg/cab* · *${msTotal.toFixed(0)} kg total/día*.\n` +
      `━\n` +
      `${racionText}\n` +
      `━\n` +
      `👉 *Peso Húmedo Total a Cargar (Mixer)*: *${wetTotal.toFixed(0)} kg/día*.\n\n` +
      `_¿Te sirve esta formulación o preferís cambiar el porcentaje de consumo o tipo de ración?_`;

    return { texto: response };
  },
});

// ---------------------------------------------------------------------------
// domain.export_animal_pdf — Exportar Ficha Clínica/Sanitaria o Trazabilidad en PDF
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.export_animal_pdf",
  description:
    "Genera un reporte oficial de trazabilidad de caravanas o planilla veterinaria sanitaria para exportar en PDF o imprimir. " +
    "Usá esta tool cuando el productor solicite: «exportar PDF», «bajar planilla sanitaria», «ficha de caravana PDF», «descargar registros ganaderos».",
  parameters: {
    type: "object",
    properties: {
      tipo: {
        type: "string",
        enum: ["trazabilidad", "sanidad"],
        description: "Tipo de reporte a exportar: 'trazabilidad' (lista de animales) o 'sanidad' (historial clínico). Opcional.",
      },
    },
  },
  execute: async (ctx, args) => {
    const tipo = args.tipo || "trazabilidad";
    const panelLink = "https://agro.habilispro.com/dashboard/cliente";
    
    const response = 
      `📄 *PLANILLA GANADERA Y CLÍNICA OFICIAL PDF*\n\n` +
      `¡Hola! He preparado la generación del reporte oficial de *${tipo === "sanidad" ? "Historial Clínico y Veterinario" : "Trazabilidad de Caravanas"}* para tu establecimiento.\n\n` +
      `Podés visualizar, imprimir o guardar el documento oficial con firmas autorizadas directamente haciendo clic en el siguiente enlace de tu Panel de Control:\n` +
      `🔗 *${panelLink}#trazabilidad*\n\n` +
      `Allí solo debés presionar el botón *Exportar PDF* al lado del buscador correspondiente. ¡Es instantáneo!`;
      
    return { texto: response };
  },
});

// ---------------------------------------------------------------------------
// domain.authorize_team_member — Autorizar integrante del equipo por WhatsApp
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.authorize_team_member",
  description:
    "Autoriza o agrega a un integrante del equipo de campo (delegado) " +
    "para que pueda interactuar con el bot en nombre del productor principal. " +
    "Usá esta tool cuando el productor solicite agregar, autorizar, dar de alta o invitar " +
    "a un operario, tractorista, encargado, socio u otro número de WhatsApp. " +
    "Requiere el nombre del integrante, su número de WhatsApp y su rol/puesto.",
  parameters: {
    type: "object",
    properties: {
      nombre: {
        type: "string",
        description: "Nombre del operario o integrante a agregar (ej: Pedro Ramirez). Obligatorio.",
      },
      whatsapp: {
        type: "string",
        description: "Número de teléfono de WhatsApp del operario (solo dígitos, ej: 5492494111222). Obligatorio.",
      },
      rol: {
        type: "string",
        description:
          "Rol o puesto del operario en el campo. Obligatorio. Debe elegirse de la siguiente lista estándar o ser ingresado como un valor personalizado (si no está en la lista):\n" +
          "- 'operario': Operario / Tractorista\n" +
          "- 'encargado': Encargado de Establecimiento\n" +
          "- 'socio': Socio / Co-propietario\n" +
          "- 'asesor': Asesor Técnico / Agrónomo\n" +
          "- 'admin': Administrativo / Contador\n" +
          "- 'veterinario': Veterinario\n" +
          "- Personalizado (cualquier otro ingresado por el productor, ej. 'Capataz', 'Contratista', etc.)",
      },
    },
    required: ["nombre", "whatsapp", "rol"],
  },
  execute: async (ctx, args) => {
    const usuarioPrincipalId = ctx.usuario?.id;
    if (!usuarioPrincipalId) {
      return { texto: "⚠️ No pude identificar tu cuenta de usuario principal para asociar el operario." };
    }

    const { query } = require("../../../config/database");
    const { normalizarTelefono, variantesTelefono } = require("../../cliente_auth");
    const { resolverPlanEfectivo } = require("../../planes");

    const nombreNorm = String(args.nombre || "").trim();
    const whatsappNorm = normalizarTelefono(args.whatsapp);
    const rolNorm = String(args.rol || "operario").trim().toLowerCase().slice(0, 20);
    const variantes = variantesTelefono(whatsappNorm);

    if (!nombreNorm) {
      return { texto: "⚠️ Necesito el nombre de contacto del operario para autorizarlo." };
    }
    if (!whatsappNorm || whatsappNorm.length < 8) {
      return { texto: "⚠️ El número de WhatsApp provisto no parece válido. Por favor ingresá solo los dígitos con código de país." };
    }

    try {
      // Validar plan de suscripción del dueño del campo y sus límites de integrantes
      const ownerUser = await query(`SELECT plan, plan_activo_hasta FROM usuarios WHERE id = $1`, [usuarioPrincipalId]);
      const planEfectivo = resolverPlanEfectivo({
        plan: ownerUser.rows[0]?.plan || "gratis",
        planActivoHasta: ownerUser.rows[0]?.plan_activo_hasta
      });

      const LIMITES_MIEMBROS = {
        gratis: 0,
        basico: 3,
        pro: 6,
        pro_max: 9999
      };
      const limiteMax = LIMITES_MIEMBROS[planEfectivo] || 0;

      if (limiteMax === 0) {
        return {
          texto: "⚠️ *Función Premium: Equipo de Campo*\n\n" +
            "Para poder autorizar integrantes de equipo, necesitás contratar un plan de pago (Básico, Pro o Pro Max).\n\n" +
            "Podés actualizar tu suscripción de inmediato desde tu Panel de Control."
        };
      }

      // Contar cuántos integrantes activos tiene actualmente el dueño
      const countActive = await query(
        `SELECT COUNT(*) FROM telefonos_autorizados WHERE usuario_principal_id = $1 AND activo = true`,
        [usuarioPrincipalId]
      );
      const actuales = parseInt(countActive.rows[0].count, 10);

      // 1. Validar que el número no esté registrado como usuario principal de pago
      const checkUser = await query(
        `
          SELECT id FROM usuarios 
          WHERE (regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = ANY($1::text[])
             OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = ANY($1::text[]))
            AND plan <> 'gratis' AND plan IS NOT NULL
          LIMIT 1
        `,
        [variantes]
      );
      if (checkUser.rows.length > 0) {
        return {
          texto: `⚠️ El número +${whatsappNorm} ya está registrado como una cuenta principal premium en AgroHabilis y no puede ser delegado.`,
        };
      }

      // 2. Upsert seguro
      const checkExist = await query(
        `
          SELECT id, activo FROM telefonos_autorizados 
          WHERE regexp_replace(COALESCE(whatsapp_autorizado, ''), '\\D', '', 'g') = ANY($1::text[])
        `,
        [variantes]
      );

      const isNew = checkExist.rows.length === 0 || !checkExist.rows[0].activo;

      if (isNew && actuales >= limiteMax) {
        return {
          texto: `⚠️ *Límite de Equipo Alcanzado*\n\n` +
            `Tu Plan *${planEfectivo.toUpperCase()}* te permite tener hasta *${limiteMax}* integrante(s) activo(s) en tu equipo.\n\n` +
            `Para poder agregar a *${nombreNorm}*, podés ingresar a tu Panel Web y subir a un plan superior.`
        };
      }

      if (checkExist.rows.length > 0) {
        await query(
          `
            UPDATE telefonos_autorizados 
            SET usuario_principal_id = $1, nombre_contacto = $2, rol = $3, activo = true, aceptado = false, whatsapp_autorizado = $4
            WHERE id = $5
          `,
          [usuarioPrincipalId, nombreNorm, rolNorm, whatsappNorm, checkExist.rows[0].id]
        );
      } else {
        await query(
          `
            INSERT INTO telefonos_autorizados (usuario_principal_id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado)
            VALUES ($1, $2, $3, $4, true, false)
          `,
          [usuarioPrincipalId, whatsappNorm, nombreNorm, rolNorm]
        );
      }

      // Enviar mensaje de invitación por WhatsApp al operario
      try {
        const { sendMessage } = require("../../../config/whatsapp");
        const nombrePrincipal = ctx.usuario?.nombre;

        // Verificar si ya es un usuario principal en el sistema para enviarle una advertencia clara
        const checkIsAlreadyUser = await query(
          `
            SELECT id FROM usuarios 
            WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = ANY($1::text[])
               OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = ANY($1::text[])
            LIMIT 1
          `,
          [variantes]
        );
        const yaEsUsuario = checkIsAlreadyUser.rows.length > 0;

        let msgInvitacion;
        if (yaEsUsuario) {
          msgInvitacion = `¡Hola *${nombreNorm}*! 🌾\n\n` +
            `*${nombrePrincipal || "Un administrador"}* te ha invitado a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rolNorm.toUpperCase()}*.\n\n` +
            `⚠️ *AVISO IMPORTANTE:* Detectamos que ya tenés una cuenta individual registrada en el sistema. Al aceptar formar parte de este equipo, *dejarás de interactuar con tu perfil personal* y todos tus registros futuros (gastos, siembras, hacienda) *se guardarán directamente en el establecimiento de ${nombrePrincipal || "quien te invitó"}*.\n\n` +
            `Para aceptar unirte al equipo de ${nombrePrincipal || "tu administrador"} como ${rolNorm.toUpperCase()}, respondé con la palabra *SI*.\n\n` +
            `Si preferís mantener tu cuenta individual independiente y rechazar esta delegación, respondé *NO*.`;
        } else {
          msgInvitacion = `¡Hola *${nombreNorm}*! 🌾\n\n` +
            `*${nombrePrincipal || "Un administrador"}* te ha invitado a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rolNorm.toUpperCase()}*.\n\n` +
            `Tu cuenta operará bajo los límites del **Plan Gratis** de AgroHabilis (con límite de 25 consultas semanales, 4 audios y hasta 2 fotos por semana).\n\n` +
            `Para aceptar esta invitación y poder registrar datos o consultar al asistente desde tu WhatsApp, respondé con la palabra *SI*.\n\n` +
            `Si querés rechazar la invitación, respondé *NO*.`;
        }

        await sendMessage(whatsappNorm, msgInvitacion);
      } catch (errWp) {
        console.error("No se pudo enviar invitacion por WhatsApp al delegado:", errWp.message);
      }

      return {
        texto:
          `✅ *¡INVITACIÓN ENVIADA CON ÉXITO!*\n\n` +
          `Agregué a *${nombreNorm}* (Rol: _${rolNorm.toUpperCase()}_) con el número *+${whatsappNorm}* a tu equipo de campo (pendiente de aceptación).\n\n` +
          `⚠️ *Nota sobre el Plan:* Este integrante operará bajo los límites del **Plan Gratis** de forma individual, pero los registros se imputarán en tu establecimiento premium.\n\n` +
          `Le acabo de enviar un mensaje de invitación automática a su celular. En cuanto responda *SI*, quedará activo y podrá registrar datos en tu establecimiento.`,
      };
    } catch (error) {
      console.error("Fallo autorizar operario por whatsapp:", error.message);
      return { texto: `⚠️ Ocurrió un error al intentar autorizar al operario: ${error.message}` };
    }
  },
});

// ---------------------------------------------------------------------------
// domain.get_machinery_telemetry — Consultar telemetría de maquinaria agrícola
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.get_machinery_telemetry",
  description:
    "Obtiene los datos y métricas consolidadas de telemetría de maquinaria agrícola " +
    "(siembra, pulverización, fertilización, cosecha) y zonas de rinde/productividad. " +
    "También sirve para iniciar el proceso de vinculación o conexión de cuentas. " +
    "Usá esta tool cuando el productor pregunte cómo conectar, vincular, enlazar o configurar su cuenta de maquinaria (John Deere, Climate FieldView, Case, etc.), " +
    "o cuando consulte por labores reales ejecutadas por máquinas, dosis reales aplicadas en el monitor, hectáreas reales trabajadas frente a nominales, " +
    "o distribución de zonas de rinde en sus lotes.",
  parameters: {
    type: "object",
    properties: {
      lote_nombre: {
        type: "string",
        description: "Nombre o fragmento del lote/corral a consultar. Opcional.",
      },
      tipo_labor: {
        type: "string",
        enum: ["siembra", "pulverizacion", "fertilizacion", "cosecha"],
        description: "Tipo de labor a consultar si el productor lo indica. Opcional.",
      },
      intent: {
        type: "string",
        enum: ["consultar", "conectar"],
        description: "Intención del productor. 'conectar' si quiere vincular, conectar, enlazar o configurar su cuenta de telemetría o maquinaria. 'consultar' por defecto.",
      },
    },
  },
  execute: async (ctx, args) => {
    const usuarioId = ctx.usuario?.id;
    if (!usuarioId) {
      return { texto: "⚠️ No pude identificar tu cuenta de usuario para consultar telemetría." };
    }

    const { query } = require("../../../config/database");
    const { resolverLotePorNombre } = require("../../inventario/core");

    const isConnecting = args.intent === "conectar" || 
      /\b(conectar|vincular|enlazar|sincronizar|sincro|asociar|configurar)\b/i.test(String(ctx.mensaje || ""));
      
    if (isConnecting) {
      const panelLink = "https://agro.habilispro.com/dashboard/cliente";
      return {
        texto: 
          `🔗 *VINCULACIÓN SEGURA DE TELEMETRÍA (NUBE A NUBE)*\n\n` +
          `Para conectar la computadora de abordo de tu maquinaria (John Deere, Climate FieldView, Case, etc.) con AgroHabilis, tenés que realizar la autorización en el portal del fabricante.\n\n` +
          `Tocá este enlace directo desde tu celular para abrir tu Panel de Control:\n` +
          `👉 *${panelLink}#telemetria*\n\n` +
          `Ahí seleccionás tu proveedor de maquinaria, iniciás sesión de forma 100% segura con tus credenciales y autorizás el enlace por única vez. ¡Es instantáneo y gratuito!`
      };
    }

    let loteId = null;
    let loteNombreExacto = null;
    let loteHectareasNominales = null;

    if (args.lote_nombre) {
      const lote = await resolverLotePorNombre(usuarioId, args.lote_nombre);
      if (lote) {
        loteId = lote.id;
        loteNombreExacto = lote.nombre;
        loteHectareasNominales = lote.hectareas;
      } else {
        return { texto: `⚠️ No encontré ningún lote que coincida con "${args.lote_nombre}" en tu catálogo.` };
      }
    }

    // 1. Consultar labores de telemetría
    let qLabores = `
      SELECT tl.tipo_labor, tl.fecha_fin, tl.hectareas_reales, tl.insumo_nombre, 
             tl.dosis_promedio, tl.unidad_dosis, tl.marca_maquinaria, tl.modelo_maquinaria,
             l.nombre AS lote_nombre, l.hectareas AS lote_hectareas
      FROM telemetria_labores tl
      JOIN ubicaciones l ON l.id = tl.ubicacion_id
      WHERE tl.usuario_id = $1
    `;
    const params = [usuarioId];

    if (loteId) {
      params.push(loteId);
      qLabores += ` AND tl.ubicacion_id = $${params.length}`;
    }
    if (args.tipo_labor) {
      params.push(args.tipo_labor);
      qLabores += ` AND tl.tipo_labor = $${params.length}`;
    }

    qLabores += ` ORDER BY tl.fecha_fin DESC, tl.id DESC LIMIT 5`;

    const rLabores = await query(qLabores, params);
    const labores = rLabores.rows || [];

    // 2. Consultar zonas de rinde/productividad si es un lote específico
    let zonas = [];
    if (loteId) {
      const rZonas = await query(
        `
          SELECT zona_etiqueta, porcentaje_area, hectareas_zona, rinde_historico
          FROM telemetria_lote_zonas
          WHERE ubicacion_id = $1
          ORDER BY porcentaje_area DESC
        `,
        [loteId]
      );
      zonas = rZonas.rows || [];
    }

    // 3. Formatear respuesta técnica
    if (!labores.length && !zonas.length) {
      let msg = "No se encontraron datos de telemetría o maquinarias vinculadas ";
      if (loteNombreExacto) msg += `para el lote *${loteNombreExacto}* `;
      msg += "en tu establecimiento. Asegurá haber vinculado tu monitor (John Deere Link o FieldView) en tu Panel de Control.";
      return { texto: msg };
    }

    const formatearFecha = (d) => {
      if (!d) return "";
      const date = new Date(d);
      return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
    };

    const bloques = [];
    if (loteNombreExacto) {
      bloques.push(`🚜 *DATOS DE TELEMETRÍA Y PRECISIÓN: LOTE ${loteNombreExacto.toUpperCase()}*`);
      if (loteHectareasNominales) {
        bloques.push(`📏 _Superficie declarada:_ ${loteHectareasNominales} ha`);
      }
    } else {
      bloques.push(`🚜 *INFORME DE TELEMETRÍA RECIENTE (MAQUINARIA)*`);
    }
    bloques.push("━━━━━━━━━━━━━━━━━━━━");

    if (labores.length) {
      bloques.push(`*Últimas Labores de Maquinaria:*`);
      labores.forEach((lab) => {
        const nomLote = lab.lote_nombre || "S/D";
        const fechaLab = formatearFecha(lab.fecha_fin);
        const dosisFormateada = Number(lab.dosis_promedio).toLocaleString("es-AR", { maximumFractionDigits: 2 });
        const hecReales = Number(lab.hectareas_reales).toFixed(1);
        const tipoL = lab.tipo_labor.toUpperCase();
        
        bloques.push(
          `• *${tipoL}* en lote *${nomLote}* (${fechaLab}):\n` +
          `  - _Insumo:_ ${lab.insumo_nombre || "S/D"}\n` +
          `  - _Superficie Trabajada (Real):_ *${hecReales} ha*\n` +
          `  - _Dosis Promedio Real:_ *${dosisFormateada} ${lab.unidad_dosis}*\n` +
          `  - _Monitor:_ ${lab.marca_maquinaria || ""} ${lab.modelo_maquinaria || ""}`
        );
      });
      bloques.push("━━━━━━━━━━━━━━━━━━━━");
    }

    if (zonas.length) {
      bloques.push(`*Estructura de Productividad y Zonas de Rinde:*`);
      zonas.forEach((z) => {
        const pct = (Number(z.porcentaje_area) * 100).toFixed(0);
        const rinde = z.rinde_historico ? `${z.rinde_historico} tn/ha` : "S/D";
        bloques.push(
          `• *Zona ${z.zona_etiqueta}* (área: _${pct}%_ | *${Number(z.hectareas_zona).toFixed(1)} ha*):\n` +
          `  - _Rendimiento Promedio Histórico:_ *${rinde}*`
        );
      });
      bloques.push("━━━━━━━━━━━━━━━━━━━━");
    }

    bloques.push(`_Fuente: Leaf API Link (John Deere/FieldView sincronizado)_`);

    return { texto: bloques.join("\n") };
  },
});

// ---------------------------------------------------------------------------
// domain.register_lote — Crear lotes o campos nuevos
// ---------------------------------------------------------------------------
registerTool({
  name: "domain.register_lote",
  description:
    "Crea o da de alta uno o varios lotes, potreros o campos nuevos en el perfil del productor. " +
    "Usá esta tool cuando el productor pide crear, agregar o dar de alta campos/lotes, o cuando pasa una planilla listando nuevos campos para dar de alta. " +
    "¡IMPORTANTE! Si el mensaje es ambiguo y enumera nombres sin aclarar si es 1 lote o varios (ej: 'Registrar lote 100, campo las mariposas y el ombú'), NO uses la tool. Respondé primero pidiendo aclaración (ej: '¿Querés registrar 3 campos separados o uno solo?'). " +
    "No la uses si solo está registrando un movimiento/siembra en un lote ya existente.",
  parameters: {
    type: "object",
    properties: {
      lotes: {
        type: "array",
        description: "Lista de lotes o campos a crear.",
        items: {
          type: "object",
          properties: {
            nombre: {
              type: "string",
              description: "Nombre del lote, parcela o potrero individual a crear (ej: 'Lote 1', 'Potrero Norte'). Obligatorio.",
            },
            hectareas: {
              type: "number",
              description: "Superficie en hectáreas del lote (opcional).",
            },
            cultivo: {
              type: "string",
              description: "Cultivo o pastura principal (opcional).",
            },
            firma: {
              type: "string",
              description: "Firma, razón social o empresa titular (ej: 'Daedaz Sociedad Anónima'). Opcional.",
            },
            cliente: {
              type: "string",
              description: "Campo o establecimiento físico al que pertenece el lote (ej: 'Don Martín', 'La Anastasia'). Opcional.",
            },
            firma_cliente: {
              type: "string",
              description: "Legacy: firma o cliente asociado de manera genérica. Opcional.",
            },
          },
          required: ["nombre"],
        },
      },
    },
    required: ["lotes"],
  },
  execute: async (ctx, args) => {
    const { rutaCrearLote } = require("../../rutas/lotes");
    const texto = await rutaCrearLote({
      args,
      usuario: ctx.usuario,
    });
    return { texto: String(texto || "").trim() };
  },
});

