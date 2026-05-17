const { respuestaIndicaCarenciaDatosInternos } = require("./fallbacks");
const { query } = require("../../config/database");
const { PREGUNTA_MARCADOR_BROADCAST } = require("../broadcast_historial");
const { normalizarWhatsapp } = require("../../models/usuario");


const envFlagGroundingConsultas = (name) => {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

const groundingExplicitamenteOffConsultas = () => {
  const v = String(process.env.GEMINI_GROUNDING_ENABLED || process.env.GEMINI_GROUNDING || "")
    .trim()
    .toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
};

/** Misma política que plantilla `consulta`: grounding ON salvo opt-out explícito. */
const groundingWebHabilitadoConsultas = () => {
  if (groundingExplicitamenteOffConsultas()) return false;
  if (envFlagGroundingConsultas("GEMINI_GROUNDING_ENABLED") || envFlagGroundingConsultas("GEMINI_GROUNDING")) {
    return true;
  }
  return Boolean(process.env.GEMINI_API_KEY?.trim());
};

const DISCLAIMER_NO_AGRO_WEB = [
  "━━━━━━━━━━━━━━━━━━━━",
  "🌐 *Referencias web* (_Google vía Gemini_)",
  "⚠️ _Fuera del núcleo AgroHabilis._ Verificá *fuente* y *fecha*.",
  "━━━━━━━━━━━━━━━━━━━━",
].join("\n");

/**
 * Fuera de foco agro: respuesta con búsqueda web (legacy).
 * Si `AGENT_DOMINIO_TURNO` está activo, `no_agro` suele resolverse antes en `agent/gates/dominio_turno` con repregunta.
 */
const responderNoAgroConGrounding = async (
  { usuario, pregunta },
  {
    getGroundingMaxCharsFn,
    generarConGroundingGoogleSearchFn,
    formatearFuentesGroundingWhatsAppFn,
    generarConPromptLibreFn,
    logConsultaFn,
  } = {}
) => {
  const getGroundingMaxChars = typeof getGroundingMaxCharsFn === "function" ? getGroundingMaxCharsFn : () => 8000;
  const generarConGroundingGoogleSearch =
    typeof generarConGroundingGoogleSearchFn === "function" ? generarConGroundingGoogleSearchFn : async () => ({ texto: "", urls: [] });
  const formatearFuentesGroundingWhatsApp =
    typeof formatearFuentesGroundingWhatsAppFn === "function" ? formatearFuentesGroundingWhatsAppFn : () => "";
  const generarConPromptLibre =
    typeof generarConPromptLibreFn === "function" ? generarConPromptLibreFn : async () => ({ texto: "" });
  const logConsulta = typeof logConsultaFn === "function" ? logConsultaFn : () => {};

  const q = String(pregunta || "").trim().slice(0, 500);
  if (!q) return "No recibí la pregunta.";
  const zona = [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "Argentina";

  if (groundingWebHabilitadoConsultas() && process.env.GEMINI_API_KEY?.trim()) {
    try {
      const maxG = getGroundingMaxChars();
      const prompt = [
        "Sos AgroHabilis en WhatsApp. El productor hizo una pregunta fuera del foco operativo agropecuario del bot (no es precio de granos, clima de campo, logística de cosecha, MATBA, MAGYP, hacienda, etc.).",
        "Respondé útil y breve (máximo 12 líneas). Formato WhatsApp: *negrita* para lo importante, _cursiva_ para matices, emojis al inicio de bloques y línea ━━━━━━━━━━━━━━━━━━━━ entre secciones si hay más de un tema.",
        "No armes una ‘consulta de mercado’: sin apartados Contexto/Lectura/Decisión/Riesgo agro, sin MATBA, fletes ni cultivos salvo que la pregunta los mencione explícitamente.",
        "Usá la búsqueda web para hechos verificables cuando haga falta (fechas, eventos, datos objetivos). No inventes.",
        "Cerrá con una sola línea invitando a volver a temas de campo: precios, clima, dólar o análisis de venta.",
        "",
        `Zona del contacto (solo contexto): ${zona}.`,
        "",
        "Pregunta:",
        q,
      ].join("\n");
      const g = await generarConGroundingGoogleSearch({ prompt, contextLabel: "consultas.no_agro" });
      let texto = String(g.texto || "").trim().slice(0, maxG);
      const urlsLine = formatearFuentesGroundingWhatsApp(g.urls);
      texto = `${texto}${urlsLine}`;
      return ["🌐 *Complemento web*", "", DISCLAIMER_NO_AGRO_WEB, "", texto].join("\n");
    } catch (err) {
      logConsulta({
        level: "warn",
        whatsapp: usuario?.whatsapp || "",
        route: "consultas_no_agro_grounding",
        message: `Grounding no agro con error: ${err.message}`,
      });
    }
  }

  const fb = await generarConPromptLibre({
    system: [
      "Sos AgroHabilis. El usuario preguntó algo fuera del foco agro operativo del bot.",
      "Respondé breve (máx. 8 líneas), español rioplatense; no inventes fechas de fenómenos si no estás seguro.",
      "Sugerí verificar en la web o fuentes oficiales y ofrecé ayuda con precios, clima o mercado en Argentina.",
    ].join("\n"),
    user: `Pregunta: ${q}`,
  });
  const t = String(fb?.texto || "").trim();
  return t || "No pude responder eso ahora. Si querés, preguntame por precios, clima o mercado en tu zona.";
};

const responderConsultaLibreIA = async ({ usuario, pregunta }, { generarConPromptLibreFn } = {}) => {
  const generarConPromptLibre =
    typeof generarConPromptLibreFn === "function" ? generarConPromptLibreFn : async () => ({ texto: "" });
  const q = String(pregunta || "").trim().slice(0, 1200);
  if (!q) return "No recibí la consulta.";
  const zona = [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "Argentina";
  const cultivos = Array.isArray(usuario?.cultivos)
    ? usuario.cultivos.map((c) => c?.cultivo).filter(Boolean).slice(0, 6).join(", ")
    : "";
  const system = [
    "Sos AgroHabilis respondiendo WhatsApp de forma útil y concreta.",
    "Interpretá libremente la intención del usuario y respondé al punto.",
    "No fuerces estructura de 'mercado' si el usuario no la pidió.",
    "Si faltan datos para afirmar algo, decilo explícitamente sin inventar.",
    "Máximo 10 líneas, formato claro de WhatsApp.",
  ].join("\n");
  const user = [
    `Zona de referencia: ${zona}`,
    `Cultivos del perfil: ${cultivos || "sin datos"}`,
    "",
    `Consulta del usuario: ${q}`,
  ].join("\n");
  const out = await generarConPromptLibre({ system, user });
  const texto = String(out?.texto || "").trim();
  return texto || "No pude interpretar bien la consulta. Probá en una línea con más contexto.";
};

const generarSaludoIAControlado = async (
  { usuario, pregunta },
  { generarConPromptLibreFn, limpiarSalidaSaludoIAFn } = {}
) => {
  const generarConPromptLibre =
    typeof generarConPromptLibreFn === "function" ? generarConPromptLibreFn : async () => ({ texto: "" });
  const limpiarSalidaSaludoIA =
    typeof limpiarSalidaSaludoIAFn === "function"
      ? limpiarSalidaSaludoIAFn
      : (x) => String(x || "").trim();

  const nombre = String(usuario?.nombre || "").trim().split(" ")[0] || "¿cómo estás?";
  const zona = [usuario?.partido, usuario?.provincia].filter(Boolean).join(", ") || "tu zona";
  const plan = String(usuario?.plan || "gratis").toUpperCase();

  const waNorm = normalizarWhatsapp(usuario?.whatsapp || "");
  let ultimoEsBroadcast = false;
  let textoBroadcast = "";
  if (waNorm) {
    try {
      const ult = await query(
        `SELECT pregunta, respuesta 
         FROM historial_consultas 
         WHERE whatsapp = $1 
         ORDER BY creado_en DESC 
         LIMIT 1`,
        [waNorm]
      );
      if (ult.rows[0] && ult.rows[0].pregunta === PREGUNTA_MARCADOR_BROADCAST) {
        ultimoEsBroadcast = true;
        textoBroadcast = ult.rows[0].respuesta || "";
      }
    } catch (e) {
      console.warn("[ia_grounding] Error consultando ultimo broadcast:", e.message);
    }
  }

  if (ultimoEsBroadcast) {
    const system = [
      "Sos AgroHabilis, el asistente inteligente y experto para el productor agropecuario argentino.",
      "El productor te está respondiendo a un mensaje de campaña/outreach que le mandaste proactivamente.",
      "Tu objetivo es dar una bienvenida sumamente cálida, distendida y profesional, explicando las increíbles capacidades de esta nueva versión del asistente, y preguntarle de forma natural qué necesita.",
      "",
      "Capacidades de la nueva versión a destacar de forma muy atractiva:",
      "1. Trazabilidad Animal Individual y Sanidad: Podés consultar y registrar el historial completo de sanidad, tratamientos, vacunas, caravanas, lotes y pesajes por chat (ej. '¿Qué historial tiene la caravana 123?'). ¡Y se sincroniza al instante con tu Panel Web de Cliente profesional!",
      "2. Registro Multimodal (Audio y Fotos): Podés mandarme un audio de voz explicando una novedad o una foto del campo o de un animal para analizar su estado en tiempo real.",
      "3. Negocios y Finanzas del Campo: Registrar gastos, ventas, y consultar tu margen del mes escribiendo 'MIS GASTOS', 'MIS VENTAS' o 'MI MARGEN'.",
      "4. Mercado y Clima en un solo lugar: Consultar precios pizarra de granos, cotizaciones de dólares (blue, bolsa/MEP, oficial), pronósticos de clima local y calcular fletes (ej. 'flete Tandil a Necochea').",
      "",
      "Reglas de respuesta:",
      "- Usá español rioplatense (cálido, cercano, 'che', 'chiflame', etc.) pero muy profesional.",
      "- NO te limites a 3 líneas. Sé completo, claro y conversacional.",
      "- No inventes datos. Si explicás qué podés hacer, usá ejemplos sencillos de cómo pedírmelo.",
      "- Generá una charla distendida y amigable. Hacele una pregunta abierta y entusiasta para que te cuente qué necesita hoy o cómo viene la jornada.",
    ].join("\n");

    const user = [
      `Nombre del productor: ${nombre}`,
      `Zona: ${zona}`,
      `Plan: ${plan}`,
      `Mensaje de campaña enviado por nosotros: "${textoBroadcast}"`,
      `Respuesta del productor: "${pregunta}"`,
      "",
      "Generá la respuesta de bienvenida completa, entablando una charla amigable y distendida.",
    ].join("\n");

    try {
      const out = await generarConPromptLibre({ system, user });
      const limpio = limpiarSalidaSaludoIA(out?.texto || "");
      if (limpio) return limpio;
    } catch (e) {
      console.warn("[ia_grounding] Error generating broadcast welcome, fallback to regular:", e.message);
    }
  }

  const system = [
    "Sos AgroHabilis.",
    "Objetivo: responder un saludo inicial de WhatsApp de forma breve y humana.",
    "Reglas estrictas:",
    "- Máximo 3 líneas.",
    "- Sin números de mercado ni bloques técnicos.",
    "- Sin etiquetas DATO REAL/CONTEXT/NO_DATA.",
    "- Sin mencionar plantillas ni planes de forma promocional.",
    "- Cerrar con una pregunta guiada: precio, clima o análisis.",
  ].join("\n");

  const user = [
    `Nombre: ${nombre}`,
    `Zona: ${zona}`,
    `Plan: ${plan}`,
    `Mensaje del usuario: ${pregunta}`,
    "Generá una bienvenida útil y cálida en español rioplatense.",
  ].join("\n");

  try {
    const out = await generarConPromptLibre({ system, user });
    const limpio = limpiarSalidaSaludoIA(out?.texto || "");
    if (limpio) return limpio;
  } catch (_e) {
    // fallback determinístico
  }

  return `¡Hola, ${nombre}! 👋\nEstoy para ayudarte con decisiones del día en ${zona}.\n¿Querés ver *precio*, *clima* o un *análisis*?`;
};

/**
 * Charla liviana sobre el tiempo sin pedido técnico explícito ("va a estar
 * lindo esta semana?") — no debe disparar bloque *Complemento web* masivo.
 */
const esCharlaTiempoConversacionalLigera = (texto = "") => {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!t || /\d/.test(t)) return false;
  if (/\b(precio|soja|ma[ií]z|trigo|dolar|cotizacion|venta|margen)\b/.test(t)) return false;
  const tiempo =
    /\b(va\s+a\s+estar|vas\s+a\s+estar|que\s+tal\s+el\s+tiempo|c[oó]mo\s+viene\s+el\s+tiempo|como\s+esta\s+el\s+tiempo)\b/.test(
      t
    );
  const tono = /\b(lindo|linda|feo|fea|bueno|buena|mal|horrible|hermoso|hermosa|semana|find|finde|fin\s+de\s+semana|jornada|dia|d[ií]a)\b/.test(
    t
  );
  return tiempo && tono;
};

const intencionSinComplementoWeb = (intencion = "") => {
  const i = String(intencion || "")
    .trim()
    .toLowerCase();
  return i === "saludo" || i === "small_talk" || i === "no_agro";
};

const enriquecerConGroundingAgroSiHaceFalta = async (
  { pregunta = "", textoBase = "", intencion = "", omitirComplementoWeb = false } = {},
  deps = {}
) => {
  const {
    tieneBloqueComplementoWebFn: tieneBloqueComplementoWeb,
    respuestaMercadoDesfasadaVersusPreguntaFn: respuestaMercadoDesfasadaVersusPregunta,
    preguntaQuedoSinCoberturaClaveFn: preguntaQuedoSinCoberturaClave,
    esRespuestaSecaSinDatosFn: esRespuestaSecaSinDatos,
    esRespuestaNoConfiableFn: esRespuestaNoConfiable,
    respuestaPrecioEscasaFn: respuestaPrecioEscasa,
    preguntaRequierePipelineConsultaIAFn: preguntaRequierePipelineConsultaIA,
    generarConGroundingGoogleSearchFn: generarConGroundingGoogleSearch,
    sanitizarPlaceholdersFn: sanitizarPlaceholders,
    getGroundingMaxCharsFn: getGroundingMaxChars,
    formatearFuentesGroundingWhatsAppFn: formatearFuentesGroundingWhatsApp,
    esPreguntaMetaConversacionalFn,
  } = deps;
  const base = String(textoBase || "").trim();
  if (!base) return base;
  if (tieneBloqueComplementoWeb(base)) return base;
  /** Saludo / charla / fuera de foco: sin anexar Google Search (UX tipo agente). */
  if (omitirComplementoWeb || intencionSinComplementoWeb(intencion)) return base;
  let metaConversacional = false;
  const metaFn = typeof esPreguntaMetaConversacionalFn === "function" ? esPreguntaMetaConversacionalFn : null;
  if (metaFn) {
    try {
      metaConversacional = Boolean(metaFn(pregunta));
    } catch (_e) {
      metaConversacional = false;
    }
  }
  if (metaConversacional || esCharlaTiempoConversacionalLigera(pregunta)) return base;
  const desfasada = respuestaMercadoDesfasadaVersusPregunta(pregunta, base);
  const sinCoberturaClave = preguntaQuedoSinCoberturaClave(pregunta, base);
  const indicaCarenciaInternos = respuestaIndicaCarenciaDatosInternos(base);
  const preguntaClimaOViento =
    /\b(clima|lluvia|helada|viento|fr[ií]o|frio|fumigar|pulveriz|temperatura|pron[oó]stico|\bel tiempo\b|humedad)/i.test(
      String(pregunta || "")
    );
  const requiereRefuerzo =
    esRespuestaSecaSinDatos(base) ||
    esRespuestaNoConfiable(base) ||
    desfasada ||
    sinCoberturaClave ||
    respuestaPrecioEscasa({ pregunta, texto: base }) ||
    indicaCarenciaInternos;
  // Regla general: carencia en base → complemento web aunque el clasificador no marque "pipeline consulta".
  if (!preguntaRequierePipelineConsultaIA(pregunta) && !indicaCarenciaInternos) return base;
  if (!requiereRefuerzo) return base;
  if (!process.env.GEMINI_API_KEY?.trim()) return base;
  try {
    const instruccionClima =
      preguntaClimaOViento && indicaCarenciaInternos
        ? [
            "CONTEXTO: consulta meteorológica / ventana de aplicación en campo. La base interna no trajo pronóstico o viento en tabla.",
            "Buscá en web pronóstico reciente para la zona argentina relevante (partido/provincia o ciudad que mencione el usuario), con foco en: tendencia térmica, lluvias, viento (km/h) y ventanas para pulverizar/fumigar si aplica.",
            "No inventes números: si hay rango entre fuentes, decilo. Incluí al menos una referencia temporal (hoy/próximos días).",
          ].join(" ")
        : "";
    const instruccionCarenciaBase =
      indicaCarenciaInternos && !instruccionClima
        ? "REGLA: la base interna AgroHabilis no tenía el dato solicitado; priorizá búsqueda web (Argentina, fuentes con fecha) para complementar."
        : "";
    const g = await generarConGroundingGoogleSearch({
      prompt: [
        desfasada
          ? "ATENCIÓN: el sistema interno devolvió datos de otro cultivo/producto que NO corresponde a la pregunta (error de enrutamiento). Ignorá esos números. Buscá en web referencia comercial reciente en Argentina alineada EXCLUSIVAMENTE a la consulta del usuario (precio, plaza o fuente si existe)."
          : sinCoberturaClave
          ? "ATENCIÓN: la respuesta interna no cubrió el foco clave de la pregunta (producto/variedad). Ignorá partes irrelevantes y buscá en web datos recientes y específicos para lo consultado."
          : "Sos asesor agropecuario para productores argentinos.",
        desfasada ? "" : "La respuesta interna no alcanzó para resolver la consulta con datos útiles.",
        instruccionCarenciaBase,
        instruccionClima ||
          "Buscá fuentes recientes y devolvé una respuesta breve, accionable y con fecha/fuente explícita.",
        instruccionClima ? "" : "No inventes datos. Si hay diferencias entre fuentes, aclaralo.",
        "",
        `Consulta: ${String(pregunta || "").slice(0, 400)}`,
        "",
        desfasada
          ? `Material interno incorrecto (no repetir como dato válido): ${base.slice(0, 450)}`
          : `Respuesta interna insuficiente: ${base.slice(0, 900)}`,
      ]
        .filter((x) => String(x || "").trim())
        .join("\n"),
      contextLabel: desfasada ? "consultas.grounding_correccion_tema" : "consultas.fallback_grounding_universal",
    });
    const textoG = sanitizarPlaceholders(String(g?.texto || "").trim()).slice(0, getGroundingMaxChars());
    if (!textoG) return base;
    const urls = formatearFuentesGroundingWhatsApp(g?.urls || []);
    const cab = ["━━━━━━━━━━━━━━━━━━━━", "🌐 *Complemento web*", "━━━━━━━━━━━━━━━━━━━━"].join("\n");
    if (desfasada) {
      const aviso =
        "⚠️ _La referencia automática no correspondía a tu consulta; abajo información buscada para lo que preguntaste._";
      return [aviso, "", cab, textoG + urls].join("\n");
    }
    if (indicaCarenciaInternos) {
      // Si la base interna vino incompleta, evitamos abrir con "no tengo datos"
      // y priorizamos la respuesta útil del grounding.
      return [cab, textoG + urls].join("\n");
    }
    return [base, "", cab, textoG + urls].join("\n");
  } catch (_e) {
    return base;
  }
};

module.exports = {
  DISCLAIMER_NO_AGRO_WEB,
  envFlagGroundingConsultas,
  enriquecerConGroundingAgroSiHaceFalta,
  generarSaludoIAControlado,
  groundingExplicitamenteOffConsultas,
  groundingWebHabilitadoConsultas,
  responderConsultaLibreIA,
  responderNoAgroConGrounding,
};
