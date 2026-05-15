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
    "Registra un movimiento en el campo del productor: venta de granos/hacienda, " +
    "gasto/compra (insumos, combustible, mano de obra, etc.), o movimiento de inventario/stock. " +
    "SOLO usá esta tool cuando el productor PROVEE datos concretos en el mensaje: " +
    "cantidad + categoría (ej: '120 novillos en lote Norte') o monto + concepto (ej: 'gasté 50000 en semilla'). " +
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
    const { rutaComando } = require("../../rutas/comando");
    const patch = {
      intencion: "comando",
      confianza: "alta",
      comando_detectado: String(args.comando || "").trim().toUpperCase(),
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
