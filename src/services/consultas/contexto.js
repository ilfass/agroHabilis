"use strict";

const { query } = require("../../config/database");
const { normalizarWhatsapp } = require("../../models/usuario");
const {
  horasFeedbackBroadcastMasivo,
  sqlMasivoAdminRecienteOtroHistorial,
} = require("../../utils/historial_broadcast_ventana");

const normSeguimientoCalendario = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!.,;:]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

const construirHistorialNaturalParaPlantilla = (filas = [], maxResp = 450) =>
  [...(filas || [])]
    .reverse()
    .map((row, i) => {
      const p = String(row?.pregunta || "").trim();
      const r = String(row?.respuesta || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, maxResp);
      return `(Turno ${i + 1}) Usuario: ${p}\n(Turno ${i + 1}) Asistente: ${r}`;
    })
    .join("\n\n");

const construirPreguntaConHiloInterpretado = (mensajeUsuario, ultimasHist, modo) => {
  const hist = construirHistorialNaturalParaPlantilla((ultimasHist || []).slice(0, 5), 460);
  const msg = String(mensajeUsuario || "").trim();
  const nseg = normSeguimientoCalendario(msg);
  let directiva =
    "**Continuidad obligatoria:** el mensaje nuevo es seguimiento del **mismo hilo temático** (clima, precios de granos, hacienda, dólar, logística u otro) que muestra la conversación reciente arriba. " +
    "No cambies el tema salvo que el usuario lo aclare implícita o explícitamente.";
  if (modo === "temporal") {
    directiva +=
      " Si el texto trata de *mañana* / *pasado mañana* en continuidad, interpretalo en calendario (Argentina): mañana = +1 día, pasado mañana = +2 días hasta donde coincida con el tipo de pedido anterior (pronóstico, precio día X, etc.).";
    if (/pasado(\s+ma[nñ]ana)?$/.test(nseg) || /^y\s+pasado/.test(nseg)) {
      directiva +=
        " En consultas meteorológicas, *pasado* / *pasado mañana* suele equivaler explícitamente al día **+2** desde hoy en Argentina.";
    } else if (/\bmanana\b/.test(nseg) || /^y\s+ma/.test(nseg)) {
      directiva += " En consultas donde el día relativo aplique: **mañana** = +1.";
    }
  } else if (modo === "duda") {
    directiva +=
      " Aquí hay **duda o confirmación**. Respondé con foco puntual sobre la respuesta anterior: fuentes, fechas límites, qué sí y qué no está en base. No inundes de bloques irrelevantes de otros dominios.";
  } else {
    directiva +=
      " Mensaje **breve y ambiguo** por sí solo: inferí contra el tema del último intercambio; no hagas dumping de otros módulos (MATBA+flete+pizarra…) si eso contradice el foco evidente del hilo.";
  }
  if (/\[AgroHabilis — mensaje del equipo/i.test(hist)) {
    directiva +=
      " Si en el historial hay un turno con **mensaje del equipo AgroHabilis** (etiqueta entre corchetes), el mensaje nuevo suele ser **feedback** a esa campaña de contacto (incluido si el equipo mandó antes un aviso largo y después un recordatorio breve por el mismo canal). Respondé con agradecimiento y síntesis; no exijas que reformulen como consulta de precios si solo comparten deseos o sugerencias.";
  }
  return [
    "=== Conversación previa en este mismo chat (más antigua arriba) ===",
    hist,
    "=== Mensaje nuevo del usuario ===",
    msg,
    "=== Directiva ===",
    directiva,
  ].join("\n\n");
};

const obtenerUltimaInteraccion = async ({ usuarioId, whatsapp }) => {
  const h = horasFeedbackBroadcastMasivo();
  const filtro = sqlMasivoAdminRecienteOtroHistorial(2);
  if (usuarioId) {
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE usuario_id = $1
          AND ${filtro}
        ORDER BY creado_en DESC
        LIMIT 1
      `,
      [usuarioId, h]
    );
    if (r.rows[0]) return r.rows[0];
  }
  if (whatsapp) {
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE whatsapp = $1
          AND ${filtro}
        ORDER BY creado_en DESC
        LIMIT 1
      `,
      [normalizarWhatsapp(whatsapp), h]
    );
    return r.rows[0] || null;
  }
  return null;
};

const obtenerUltimasInteracciones = async ({ usuarioId, whatsapp, limite = 3 }) => {
  /**
   * Cap subido de 8 → 12 para casos "agente" donde el productor carga
   * varios lotes seguidos o hace seguimientos largos ("y el resto?",
   * "podés con varios?"). Los callers piden lo que necesitan; este es
   * solo el techo de seguridad para no romper performance.
   */
  const n = Math.min(Math.max(Number(limite) || 1, 1), 12);
  const h = horasFeedbackBroadcastMasivo();
  const filtro = sqlMasivoAdminRecienteOtroHistorial(2);
  if (usuarioId) {
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE usuario_id = $1
          AND ${filtro}
        ORDER BY creado_en DESC
        LIMIT $3
      `,
      [usuarioId, h, n]
    );
    if (r.rows.length) return r.rows;
  }
  if (whatsapp) {
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE whatsapp = $1
          AND ${filtro}
        ORDER BY creado_en DESC
        LIMIT $3
      `,
      [normalizarWhatsapp(whatsapp), h, n]
    );
    return r.rows || [];
  }
  return [];
};

const extraerZonaTexto = (texto = "") => {
  const t = String(texto || "");
  const m = t.match(/\ben\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]{3,50})/i);
  if (!m?.[1]) return null;
  let zona = m[1]
    .replace(/\b(tuvo|hay|hubo|est[aá]|esta|esta semana|hoy|ayer|helada|clima)\b.*$/i, "")
    .replace(/[?.,;:!].*$/g, "")
    .trim();
  if (!zona) return null;
  zona = zona.split(/\s{2,}/)[0].trim();
  return zona || null;
};

const armarContextoDatos = ({
  usuario,
  precios,
  tipoCambio,
  cultivos,
  clima,
  futuros,
  analyticsConsulta = null,
  marcoReferenciaHacienda = null,
} = {}) => {
  return JSON.stringify(
    {
      unidades_y_significado: {
        precios_ars:
          "Cada fila con moneda ARS es precio de granos por TONELADA (pizarra/plaza local, ej. AFA o CAC), no por kilo ni por hectárea.",
        precios_usd:
          "Cada fila con moneda USD es referencia FOB/exportación u homóloga en dólares por TONELADA (ej. MAGYP FOB oficial), salvo que el campo mercado indique otra convención.",
        tipo_cambio:
          "tipo_cambio.valor es ARS por 1 USD según la categoría (oficial, blue, bolsa, ccl); corresponde a la cotización del día indicado.",
      },
      usuario: usuario
        ? {
            id: usuario.id,
            nombre: usuario.nombre,
            whatsapp: usuario.whatsapp,
            provincia: usuario.provincia,
            partido: usuario.partido,
            lat: usuario.lat,
            lng: usuario.lng,
            plan: usuario.plan,
            activo: usuario.activo,
          }
        : null,
      precios: {
        fecha: precios.fecha,
        items: precios.items,
      },
      tipo_cambio: {
        fecha: tipoCambio.fecha,
        items: tipoCambio.items,
      },
      fuentes_contexto: {
        precios: {
          origen: "base_interna_agrohabilis_tabla_precios",
          fecha: precios.fecha,
        },
        tipo_cambio: {
          origen: "base_interna_agrohabilis_tabla_tipo_cambio",
          fecha: tipoCambio.fecha,
        },
        clima: {
          origen: "base_interna_agrohabilis_tabla_clima",
          fecha_referencia: (clima || []).length ? clima[clima.length - 1]?.fecha : null,
        },
        futuros_matba: {
          origen: "base_interna_agrohabilis_tabla_futuros_posiciones",
          fecha_referencia: (futuros || []).length ? futuros[0]?.fecha : null,
        },
      },
      cultivos_usuario: cultivos,
      futuros_matba: futuros,
      clima_zona_usuario: clima,
      analitica_consulta: analyticsConsulta,
      marco_referencia_hacienda: marcoReferenciaHacienda,
    },
    null,
    2
  );
};

const construirContextoRelacionadoTemaLibre = async (
  { tema = "", nivel = "INTERMEDIO", temaConversacion = null, ultimaPregunta = "" } = {},
  deps = {}
) => {
  const { normMinFn, queryFn, toISODateParamFn, formatearFechaEsFn, formatearMonedaFn, adaptarRespuestaPorNivelFn } =
    deps;
  const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase().trim();
  const querySafe = typeof queryFn === "function" ? queryFn : async () => ({ rows: [] });
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const formatearFechaEs = typeof formatearFechaEsFn === "function" ? formatearFechaEsFn : (x) => String(x || "");
  const formatearMoneda = typeof formatearMonedaFn === "function" ? formatearMonedaFn : (v) => String(v ?? "");
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function"
      ? adaptarRespuestaPorNivelFn
      : (_nivel, bloques) => bloques?.intermedio || "";

  const temaNorm = norm(tema);
  const temaConvNorm = norm(temaConversacion || "");
  const terminos = [temaNorm, temaConvNorm].filter(Boolean);
  if (!terminos.length) {
    return adaptarRespuestaPorNivel(nivel, {
      simple: "No tengo contexto adicional disponible ahora.",
      intermedio: "No tengo contexto adicional disponible ahora.",
      tecnico: "No tengo contexto adicional disponible ahora.",
    });
  }

  const whereNoticias = terminos
    .map(
      (_, idx) =>
        `(LOWER(titulo) LIKE $${idx + 1} OR LOWER(COALESCE(resumen, '')) LIKE $${idx + 1} OR LOWER(COALESCE(categoria, '')) LIKE $${idx + 1})`
    )
    .join(" OR ");
  const noticiasR = await querySafe(
    `
      SELECT titulo, fuente, COALESCE(publicado_en, creado_en) AS fecha_ref
      FROM noticias_agro
      WHERE ${whereNoticias}
      ORDER BY COALESCE(publicado_en, creado_en) DESC
      LIMIT 2
    `,
    terminos.map((t) => `%${t}%`)
  );
  const noticias = noticiasR.rows || [];

  const cultivosRefGlobales = ["soja", "maiz", "maíz", "trigo", "girasol", "cebada", "sorgo", "papa"];
  let fechaPrecios = null;
  if (temaConvNorm && cultivosRefGlobales.includes(temaConvNorm)) {
    const frC = await querySafe(`SELECT MAX(fecha) AS fecha FROM precios WHERE LOWER(TRIM(cultivo)) = LOWER($1)`, [
      temaConvNorm,
    ]);
    fechaPrecios = toISODateParam(frC.rows[0]?.fecha);
  }
  if (!fechaPrecios) {
    const fechaPreciosR = await querySafe("SELECT MAX(fecha) AS fecha FROM precios");
    fechaPrecios = toISODateParam(fechaPreciosR.rows[0]?.fecha);
  }
  let referencias = [];
  let referenciaContextual = null;
  if (fechaPrecios) {
    if (temaConvNorm && ["soja", "maiz", "trigo", "girasol", "cebada", "sorgo", "papa"].includes(temaConvNorm)) {
      const refCtxR = await querySafe(
        `
          SELECT cultivo, AVG(precio)::numeric(12,2) AS precio, MAX(moneda) AS moneda
          FROM precios
          WHERE fecha = $1::date
            AND LOWER(cultivo) = LOWER($2)
          GROUP BY cultivo
          LIMIT 1
        `,
        [fechaPrecios, temaConvNorm]
      );
      referenciaContextual = refCtxR.rows[0] || null;
    }
    const refR = await querySafe(
      `
        SELECT cultivo, AVG(precio)::numeric(12,2) AS precio, MAX(moneda) AS moneda
        FROM precios
        WHERE fecha = $1::date
        GROUP BY cultivo
        ORDER BY cultivo
        LIMIT 4
      `,
      [fechaPrecios]
    );
    referencias = refR.rows || [];
  }

  const bloqueContextoChat = ultimaPregunta
    ? `Veníamos conversando sobre: "${String(ultimaPregunta).slice(0, 120)}".`
    : "No tengo un hilo previo claro para esta consulta.";
  const bloqueNoticias = noticias.length
    ? `Noticias relacionadas: ${noticias
        .map((n) => `${n.titulo} (${n.fuente || "fuente s/d"}, ${toISODateParam(n.fecha_ref) || "s/f"})`)
        .join(" | ")}`
    : "No encontré noticias recientes específicas del tema.";
  const bloqueRefContextual =
    referenciaContextual && Number.isFinite(Number(referenciaContextual.precio))
      ? `${String(referenciaContextual.cultivo || temaConvNorm).toUpperCase()}: ${formatearMoneda(
          referenciaContextual.precio,
          referenciaContextual.moneda || "ARS"
        )} (ref ${formatearFechaEs(fechaPrecios)})`
      : null;
  const bloqueRefs = referencias.length
    ? `Referencias amplias: ${referencias
        .map((r) => `${r.cultivo}: ${formatearMoneda(r.precio, r.moneda || "ARS")}`)
        .join(" | ")}`
    : "Sin referencias de precios amplias para hoy.";

  const simple = [
    "No tengo dato puntual para responder exacto ahora.",
    bloqueRefContextual || bloqueRefs,
    "Si querés, te doy una recomendación práctica con lo disponible.",
  ]
    .filter(Boolean)
    .join("\n");
  const intermedio = [
    "Contexto alternativo disponible:",
    `- ${bloqueContextoChat}`,
    `- ${bloqueNoticias}`,
    ...(bloqueRefContextual ? [`- ${bloqueRefContextual}`] : []),
    `- ${bloqueRefs}`,
    "- También puedo comparar tendencia 7 días de cultivos disponibles para orientarte la decisión.",
  ].join("\n");
  const tecnico = [
    "Contexto alternativo disponible:",
    bloqueContextoChat,
    bloqueNoticias,
    ...(bloqueRefContextual ? [bloqueRefContextual] : []),
    bloqueRefs,
    "Si definís producto/mercado, te devuelvo rango, promedio y señal operativa sin estimar valores no verificados.",
  ].join("\n");
  return adaptarRespuestaPorNivel(nivel, { simple, intermedio, tecnico });
};

const construirFallbackSeguroDesdeContexto = (
  { pregunta, cultivoDetectado = null, precios, tipoCambio, clima, nivel = "INTERMEDIO" } = {},
  deps = {}
) => {
  const { detectarTemaGeneralFn, formatearFechaEsFn, toISODateParamFn, construirFallbackDecisionUniversalFn, adaptarRespuestaPorNivelFn } =
    deps;
  const detectarTemaGeneral = typeof detectarTemaGeneralFn === "function" ? detectarTemaGeneralFn : () => "mercado";
  const formatearFechaEs = typeof formatearFechaEsFn === "function" ? formatearFechaEsFn : (x) => String(x || "");
  const toISODateParam = typeof toISODateParamFn === "function" ? toISODateParamFn : (x) => x;
  const construirFallbackDecisionUniversal =
    typeof construirFallbackDecisionUniversalFn === "function" ? construirFallbackDecisionUniversalFn : () => ({});
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function"
      ? adaptarRespuestaPorNivelFn
      : (_nivel, bloques) => bloques?.intermedio || "";

  const tema = detectarTemaGeneral(pregunta, cultivoDetectado);
  const hayPrecios = Array.isArray(precios?.items) && precios.items.length > 0;
  const hayTc = Array.isArray(tipoCambio?.items) && tipoCambio.items.length > 0;
  const hayClima = Array.isArray(clima) && clima.length > 0;

  let contexto = "mercado con referencias parciales";
  if (tema === "hacienda") {
    contexto = "hacienda sin actualización puntual de categoría, con mercado de referencia estable";
  } else if (tema === "tipo de cambio") {
    contexto = hayTc
      ? `tipo de cambio disponible al ${formatearFechaEs(tipoCambio?.fecha)}`
      : "tipo de cambio sin corte confirmado en este momento";
  } else if (tema === "clima") {
    contexto = hayClima ? "pronóstico disponible para tu zona en próximos días" : "pronóstico incompleto para tu zona";
  } else if (tema === "insumos") {
    contexto = "costos de insumos con actualización parcial";
  } else if (hayPrecios) {
    contexto = `precios disponibles al ${formatearFechaEs(precios?.fecha)}`;
  }

  const bloques = construirFallbackDecisionUniversal({
    nivel,
    tema,
    detalleFalta: `No tengo el dato puntual de ${tema} para responder exacto ahora.`,
    contexto,
    accion: "si la decisión es esta semana, avanzá en forma parcial y lo cerramos cuando entre el próximo dato validado.",
    fechaRef: toISODateParam(precios?.fecha) || toISODateParam(tipoCambio?.fecha) || null,
  });
  return adaptarRespuestaPorNivel(nivel, bloques);
};

const construirRespuestaInteligenteGeneral = async (
  { pregunta, usuario, precios, tipoCambio, clima, nivel = "INTERMEDIO" } = {},
  deps = {}
) => {
  const { generarRespuestaConsultaFn, esRespuestaSecaSinDatosFn, construirFallbackDecisionUniversalFn, adaptarRespuestaPorNivelFn, logConsultaFn, fechaISOArgentinaFn } =
    deps;
  const generarRespuestaConsulta =
    typeof generarRespuestaConsultaFn === "function" ? generarRespuestaConsultaFn : async () => ({ texto: "" });
  const esRespuestaSecaSinDatos = typeof esRespuestaSecaSinDatosFn === "function" ? esRespuestaSecaSinDatosFn : () => false;
  const construirFallbackDecisionUniversal =
    typeof construirFallbackDecisionUniversalFn === "function" ? construirFallbackDecisionUniversalFn : () => ({});
  const adaptarRespuestaPorNivel =
    typeof adaptarRespuestaPorNivelFn === "function"
      ? adaptarRespuestaPorNivelFn
      : (_nivel, bloques) => bloques?.intermedio || "";
  const logConsulta = typeof logConsultaFn === "function" ? logConsultaFn : () => {};
  const fechaISOArgentina = typeof fechaISOArgentinaFn === "function" ? fechaISOArgentinaFn : () => null;

  try {
    const contextoDatos = JSON.stringify(
      {
        fecha_hoy_ar: fechaISOArgentina(),
        usuario: {
          nombre: usuario?.nombre || null,
          zona: `${usuario?.partido || ""}, ${usuario?.provincia || ""}`.trim(),
          plan: usuario?.plan || null,
          perfil: usuario?.perfil_productivo || null,
        },
        pregunta,
        datos_disponibles: {
          precios_fecha: precios?.fecha || null,
          precios_items: (precios?.items || []).slice(0, 20),
          tipo_cambio_fecha: tipoCambio?.fecha || null,
          tipo_cambio_items: (tipoCambio?.items || []).slice(0, 6),
          clima_items: (clima || []).slice(0, 5),
        },
        instruccion: "Si falta el dato puntual, no cortar. Dar referencia de mercado si existe y una recomendación práctica corta.",
      },
      null,
      2
    );
    const ia = await generarRespuestaConsulta({ contextoDatos, pregunta });
    const txt = String(ia?.texto || "").trim();
    if (txt && !esRespuestaSecaSinDatos(txt)) return txt;
  } catch (error) {
    logConsulta({
      level: "warn",
      whatsapp: usuario?.whatsapp || "",
      route: "ia_fallback_inteligente",
      message: `IA fallback inteligente no disponible: ${error.message}`,
    });
  }

  const bloques = construirFallbackDecisionUniversal({
    nivel,
    tema: "consulta",
    detalleFalta: "No tengo el dato puntual actualizado para esa consulta.",
    contexto: "hay referencias parciales de mercado, pero no confirmación específica",
    accion: "si la decisión es hoy, avanzá parcial y confirmamos con el próximo dato.",
  });
  return adaptarRespuestaPorNivel(nivel, bloques);
};

module.exports = {
  normSeguimientoCalendario,
  construirHistorialNaturalParaPlantilla,
  construirPreguntaConHiloInterpretado,
  obtenerUltimaInteraccion,
  obtenerUltimasInteracciones,
  extraerZonaTexto,
  armarContextoDatos,
  construirContextoRelacionadoTemaLibre,
  construirFallbackSeguroDesdeContexto,
  construirRespuestaInteligenteGeneral,
  extraerTemaDesdePregunta: (texto = "", { normMinFn } = {}) => {
    const norm = typeof normMinFn === "function" ? normMinFn : (x) => String(x || "").toLowerCase();
    const t = norm(texto);
    const m = t.match(/\b(?:y\s+los?|los?|las?|el|la)\s+([a-záéíóúñ]{3,})\b/i);
    if (m?.[1]) return m[1];
    const k = t.match(/\bprecios?\s+de\s+([a-záéíóúñ]{3,})\b/i);
    if (k?.[1]) return k[1];
    return null;
  },
  detectarTemaConversacion: ({
    ultimaPregunta = "",
    ultimaRespuesta = "",
    cultivosPerfil = [],
    detectarCultivoConsultaFn,
    detectarCultivoEnTextoFn,
    detectarTemaGeneralFn,
  } = {}) => {
    const detectarCultivoConsulta =
      typeof detectarCultivoConsultaFn === "function" ? detectarCultivoConsultaFn : () => null;
    const detectarCultivoEnTexto =
      typeof detectarCultivoEnTextoFn === "function" ? detectarCultivoEnTextoFn : () => null;
    const detectarTemaGeneral =
      typeof detectarTemaGeneralFn === "function" ? detectarTemaGeneralFn : () => null;

    const cultivoPrevio =
      detectarCultivoConsulta(ultimaPregunta, cultivosPerfil.map((c) => ({ cultivo: c }))) ||
      detectarCultivoEnTexto(ultimaRespuesta) ||
      detectarCultivoEnTexto(ultimaPregunta);
    if (cultivoPrevio) return cultivoPrevio;
    const temaPrevio = detectarTemaGeneral(`${ultimaPregunta} ${ultimaRespuesta}`);
    return temaPrevio === "mercado" ? null : temaPrevio;
  },
  completarPerfilDesdeConsulta: async (
    usuario,
    contexto = {},
    { queryFn, normalizarTextoComandoFn } = {}
  ) => {
    if (!usuario?.id || typeof queryFn !== "function" || typeof normalizarTextoComandoFn !== "function") return "";
    const preguntaNorm = normalizarTextoComandoFn(contexto.pregunta || "").toLowerCase();
    const cultivos = Array.isArray(usuario.cultivos) ? usuario.cultivos : [];
    const costoFaltante = cultivos.length > 0 && cultivos.every((c) => c.costo_por_ha == null);

    const consultaMargen =
      preguntaNorm.includes("margen") ||
      preguntaNorm.includes("rentabilidad") ||
      preguntaNorm.includes("conviene vender") ||
      (preguntaNorm.includes("conviene") && preguntaNorm.includes("vender"));
    if (consultaMargen && costoFaltante) {
      return "💡 Para darte el margen exacto necesito tu costo por hectárea. ¿Lo sabés? Respondé con un número en USD.";
    }

    const consultaHacienda =
      preguntaNorm.includes("hacienda") ||
      preguntaNorm.includes("ganad") ||
      preguntaNorm.includes("novillo") ||
      preguntaNorm.includes("ternero");
    if (consultaHacienda) {
      const stock = await queryFn(
        `
          SELECT 1
          FROM stock_ganadero
          WHERE usuario_id = $1
          LIMIT 1
        `,
        [usuario.id]
      );
      if (!stock.rows[0]) {
        return "💡 ¿Tenés hacienda propia? Si me decís cuántas cabezas tenés puedo darte un análisis más completo.";
      }
    }
    return "";
  },
};
