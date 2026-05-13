"use strict";

/**
 * # Clasificador de intenciones — rol en la arquitectura de agente
 *
 * Este módulo NO es la fuente de verdad de la decisión del turno. Es la **primera
 * capa** de un pipeline tipo agente (estilo Cursor / OpenAI tool-use):
 *
 *   1) Clasificador (acá)
 *      - Devuelve un *hint* de intención: `precio`, `clima`, `registrar`, etc.
 *      - Usa heurística primero (rápida, gratis, determinista) y solo recurre
 *        a IA (Groq → Gemini) cuando la heurística no alcanza.
 *      - Recibe historial reciente para entender mensajes ambiguos en contexto.
 *
 *   2) Refuerzos (en el pipeline)
 *      - `aplicarRefuerzoRegistroInventario`: si el mensaje habla de inventario,
 *        el intent se fuerza a `registrar` aunque la IA haya dicho otra cosa.
 *      - `aplicarRefuerzoSeguimientoHistorial`: si el mensaje es seguimiento
 *        ("y el resto?") y el último turno fue inventario, se fuerza `registrar`.
 *
 *   3) Gates (`agent/gates/*`)
 *      - Hilo de registro: ¿el productor en realidad quería gasto/registro?
 *      - Dominio del turno: ¿esto es agro o estamos fuera de foco?
 *
 *   4) Scout (`agent/ia/tool_loop_scout`)
 *      - IA con *tool calls* que va a buscar datos (lotes, saldos, precios)
 *        antes de decidir la respuesta. Aquí está lo más "agente puro".
 *
 *   5) Observe-Act-Verify chain (`agent/plan/oav_chain`)
 *      - Ejecuta `router` con reintentos verificados. Si la primera respuesta
 *        no pasa verify, vuelve a intentar con más contexto.
 *
 * **Por qué no IA libre:** en un canal WhatsApp con productores, latencia +
 * costo + determinismo de comandos (`MI RESUMEN`, `PLANES`) y confirmaciones
 * de inventario (`SI/NO`) requieren *fast-path* heurístico. El LLM trabaja
 * libre en el scout y el router; el clasificador solo decide a *qué ruta*
 * mandar el turno.
 */

const { generarChatGroq } = require("./groq");
const { generarTextoClasificadorRapido } = require("./gemini");
const { hayProveedorIa } = require("./agent/ia/json_chain");
const { esConsultaDolarRapida, tieneTemaOperativoSaludo } = require("./intent_classifier");
const { esConsultaInsumos } = require("./consultas/precios");
const { esConsultaHaciendaVenta } = require("./consultas/hacienda");
const { parseIntentInventario } = require("./inventario/nl_heuristica");

const INTENCIONES = new Set([
  "precio",
  "analisis_mercado",
  "analisis_interno",
  "clima",
  "registrar",
  "consulta_registros",
  "agro_general",
  "no_agro",
  "saludo",
  "small_talk",
  "comando",
]);

/** Orden fijo para el prompt: la IA debe elegir UNA de estas cadenas exactas. */
const ETIQUETAS_INTENCION_PROMPT = [
  "precio",
  "analisis_mercado",
  "analisis_interno",
  "clima",
  "registrar",
  "consulta_registros",
  "agro_general",
  "no_agro",
  "saludo",
  "small_talk",
  "comando",
];

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parsearJSON = (textoBruto = "") => {
  const raw = String(textoBruto || "").trim();
  if (!raw) throw new Error("Clasificador: respuesta vacía");
  const sinFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = sinFence.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : sinFence;
  const obj = JSON.parse(jsonStr);
  return obj;
};

const defaultsClasificacion = () => ({
  intencion: "agro_general",
  cultivo: null,
  producto: null,
  zona_mencionada: null,
  requiere_datos_propios: false,
  confianza: "baja",
  comandoIa: null,
  variante_precio: null,
  ayuda_recurso: null,
  meta_consulta: null,
});

/** Si la IA del clasificador falla y hay proveedores configurados: sin heurística (router + agent_turn dominan). */
const clasificadorFallbackUsaHeuristica = () => {
  if (!hayProveedorIa()) return true;
  const fb = String(process.env.CLASSIFIER_FALLBACK || "")
    .trim()
    .toLowerCase();
  return fb === "heuristica" || fb === "hibrido";
};

const fallbackClasificacionIaAgotada = () =>
  normalizarClasificacion({
    intencion: "agro_general",
    confianza: "baja",
  });

/**
 * Preferencia: Groq llama-3.1-8b-instant → Gemini Flash → fallo.
 */
const llamarIAClasificador = async (promptCompleto) => {
  const system = [
    "Sos el clasificador de intenciones de AgroHabilis (productores argentinos por WhatsApp).",
    "Leé el mensaje del usuario y elegí UNA sola etiqueta de intención entre las que te lista el usuario en el prompt (vocabulario cerrado).",
    "El valor de intencion debe ser literalmente una de las etiquetas listadas en el user (misma cadena; no un sinónimo).",
    "Respondé EXCLUSIVAMENTE un objeto JSON válido (sin markdown, sin texto antes ni después).",
  ].join(" ");

  if (process.env.GROQ_API_KEY?.trim()) {
    try {
      const { texto } = await generarChatGroq({
        system,
        user: promptCompleto,
        maxTokens: Number(process.env.CLASIFICADOR_MAX_TOKENS || 100),
      });
      return String(texto || "").trim();
    } catch (e) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("[clasificador] Groq falló, intentando Gemini:", e.message);
      }
    }
  }

  if (process.env.GEMINI_API_KEY?.trim()) {
    const { texto } = await generarTextoClasificadorRapido(`${system}\n\n${promptCompleto}`);
    return String(texto || "").trim();
  }

  throw new Error("Sin GROQ_API_KEY ni GEMINI_API_KEY para clasificador");
};

/**
 * Misma señal que `nl_heuristica` para inventario: si la IA se confunde (p. ej. clima por un nombre de campo),
 * forzamos `registrar` para que `rutaRegistrar` → inventario resuelva lote/categoría.
 * Incluye **consultas** de stock («cuántas vacas tengo en el caimán»), que antes caían en `agro_general`
 * y la IA inventaba «sin datos en base» sin mirar la tabla de inventario.
 */
const aplicarRefuerzoRegistroInventario = (mensaje, clasificacion) => {
  if (!clasificacion || typeof clasificacion !== "object") return clasificacion;
  try {
    const tn = norm(mensaje);
    if (/\b(me\s+)?conviene\s+vender\b|\bvender\s+o\s+esperar\b|\bdebo\s+vender\b/.test(tn)) {
      return clasificacion;
    }
    const inv = parseIntentInventario(mensaje);
    if (inv?.clase !== "registro" && inv?.clase !== "consulta") return clasificacion;
    if (inv?.clase === "ambiguo") return clasificacion;
    const mal = new Set([
      "clima",
      "agro_general",
      "analisis_mercado",
      "analisis_interno",
      "no_agro",
      "precio",
      "saludo",
      "consulta_registros",
    ]);
    if (!mal.has(clasificacion.intencion)) return clasificacion;
    return {
      ...clasificacion,
      intencion: "registrar",
      confianza: "alta",
      requiere_datos_propios: false,
    };
  } catch (_e) {
    return clasificacion;
  }
};

/**
 * Si el mensaje es un *seguimiento corto* ("y el resto?", "y los demás?",
 * "agregamos también...") y el último turno del bot fue claramente de
 * inventario (confirmación o pedido de aclaración), forzamos `registrar`
 * para que el pipeline retome la carga en vez de derivar a precios/clima.
 *
 * Esta heurística corre **además del refuerzo IA** y cubre el caso sin
 * LLM disponible.
 */
const aplicarRefuerzoSeguimientoHistorial = (mensaje, clasificacion, historial) => {
  if (!clasificacion || typeof clasificacion !== "object") return clasificacion;
  if (!Array.isArray(historial) || !historial.length) return clasificacion;
  const tn = norm(mensaje);
  if (!tn || tn.length > 80) return clasificacion;

  const esSeguimiento =
    /\by\s+(el|los|las)\s+(resto|demas|otros|otras)\b/.test(tn) ||
    /\b(el|los|las)\s+(resto|demas|otros|otras)\b/.test(tn) ||
    /^y\s+(?:el\s+)?resto\??$/.test(tn) ||
    /\b(agregamos|agreguemos|agregale|agrego|sumamos|sumale|tambien\s+(estos|los|las|cargamos|guardamos))\b/.test(tn) ||
    /\b(seguimos|continuamos|continuar|seguir)\s+(cargando|con\s+los|con\s+las)\b/.test(tn);
  if (!esSeguimiento) return clasificacion;

  const ultimaRespBot = String(historial[0]?.respuesta || "");
  const tBot = norm(ultimaRespBot);
  const ultimoTurnoFueInventario =
    /guardado\s+en\s+inventario/.test(tBot) ||
    /confirma\s+el\s+ingreso\s+al\s+inventario/.test(tBot) ||
    /(no\s+pude\s+interpretar|cantidad\s+y\s+categoria)/.test(tBot) ||
    /no\s+encontre\s+el\s+lote/.test(tBot) ||
    /lote\s+\w+\s+creado/.test(tBot);

  if (!ultimoTurnoFueInventario) return clasificacion;
  if (clasificacion.intencion === "registrar") return clasificacion;

  return {
    ...clasificacion,
    intencion: "registrar",
    confianza: clasificacion.confianza || "media",
    requiere_datos_propios: false,
    _refuerzoSeguimientoHistorial: true,
  };
};

const clasificarHeuristica = (mensaje = "") => {
  const t = norm(mensaje);
  const u = String(mensaje || "").toUpperCase().trim();
  const out = defaultsClasificacion();

  if (/^(PAUSAR BOT|ACTIVAR BOT|ESTADO BOT)\s*$/i.test(String(mensaje || "").trim())) {
    out.intencion = "comando";
    out.confianza = "alta";
    return out;
  }

  const comandos = [
    "MI RESUMEN",
    "MIS ALERTAS",
    "MI MARGEN",
    "PLANES",
    "VER COMANDOS",
    "COMPLETAR PERFIL",
  ];
  if (comandos.some((c) => u.includes(c))) {
    out.intencion = "comando";
    out.confianza = "alta";
    return out;
  }

  if (/\b(avisame|av[ií]same|avisar\s+cuando)\b/i.test(t) && /\d/.test(t)) {
    out.intencion = "comando";
    out.confianza = "media";
    return out;
  }

  if (/\b(conviene\s+vender|vender\s+o\s+esperar|debo\s+vender)\b/.test(t)) {
    out.intencion = "analisis_mercado";
    out.confianza = "media";
    return out;
  }

  try {
    const invInv = parseIntentInventario(mensaje);
    if (invInv?.clase === "registro" || invInv?.clase === "consulta") {
      out.intencion = "registrar";
      out.confianza = "alta";
      return out;
    }
  } catch (_e) {
    /* seguimos */
  }

  if (esConsultaDolarRapida(mensaje)) {
    out.intencion = "precio";
    out.variante_precio = "dolar";
    out.confianza = "media";
    return out;
  }
  /** No confundir cotización de insumos con alta de gasto/compra con monto explícito */
  if (
    !/\bcu[aá]nto\s+gast/.test(t) &&
    /\b(gast[eé]|compr[eé])\b/.test(t) &&
    /\d/.test(mensaje)
  ) {
    out.intencion = "registrar";
    out.confianza = "media";
    return out;
  }
  if (esConsultaInsumos(mensaje)) {
    out.intencion = "precio";
    out.producto = "insumo";
    out.confianza = "media";
    return out;
  }
  if (esConsultaHaciendaVenta(mensaje)) {
    out.intencion = "precio";
    out.producto = "hacienda";
    out.confianza = "media";
    return out;
  }

  const saludos = /\b(hola|buen[oa]s?|buen\s+d[ií]a|chau|gracias|muchas\s+gracias)\b/;
  if (saludos.test(t) && t.length < 48 && !/\?/.test(mensaje) && !tieneTemaOperativoSaludo(t)) {
    out.intencion = "saludo";
    out.confianza = "media";
    return out;
  }

  /**
   * Small talk: charla social sin pedido operativo (estados de ánimo, OK breve,
   * confirmaciones de aire, risas, agradecimientos enmascarados). No es saludo
   * propiamente dicho, pero tampoco hay que rechazarlo con el gate de dominio.
   *
   * Cuidado: NO debe pisar mensajes con números (suelen ser cargas) ni con tema
   * agro operativo (precio, lote, etc.).
   */
  const mensajeTrim = String(mensaje || "").trim();
  const smallTalkExacto =
    /^(?:ok|okey|dale|listo|perfecto|buenisimo|buen[ií]simo|genial|barbaro|excelente|de\s+nada|(?:j[aeiAEI]){2,}|si\s*si|claro|tal\s+cual|seguro|cuando\s+quieras|copiado)\W*$/i;
  const estadoAnimo =
    /\b(tengo\s+sue[nñ]o|estoy\s+cansad[oa]|que\s+(pena|bueno|lindo|lastima|mal)|me\s+aburro|estoy\s+aburrid[oa]|me\s+da\s+(risa|pena|bronca)|que\s+onda|todo\s+bien|c[oó]mo\s+andas|c[oó]mo\s+va|que\s+haces|que\s+tal|que\s+frio|que\s+calor)\b/;
  if (
    (smallTalkExacto.test(mensajeTrim) || estadoAnimo.test(t)) &&
    t.length < 60 &&
    !/\d/.test(t) &&
    !tieneTemaOperativoSaludo(t)
  ) {
    out.intencion = "small_talk";
    out.confianza = "media";
    return out;
  }

  if (/\b(con\s+mis\s+costos|mis\s+costos|me\s+da\s+con\s+mis\s+costos)\b/.test(t)) {
    out.intencion = "analisis_interno";
    out.requiere_datos_propios = true;
    out.confianza = "media";
    return out;
  }

  const consultaPropia =
    /\b(cu[aá]nto\s+gast[eé]|cu[aá]ntos\s+animales|cu[aá]ndo\s+vacun[eé]|mis\s+registros|mi\s+inventario)\b/;
  if (consultaPropia.test(t)) {
    out.intencion = "consulta_registros";
    out.requiere_datos_propios = true;
    out.confianza = "media";
    return out;
  }

  const registro =
    /\b(gast[eé]|compr[eé]|vend[ií]|naci[oó]|vacun[eé]|llovi[oó]|apliqu[eé]|sembr[eé])\b/;
  if (registro.test(t)) {
    out.intencion = "registrar";
    out.confianza = "media";
    return out;
  }

  const clima =
    /\b(lluvia|helada|temperatura|tiempo|pron[oó]stico|clima|llovier|llover|mm\b|mil[ií]metros)\b/;
  if (clima.test(t)) {
    out.intencion = "clima";
    out.confianza = "media";
    return out;
  }

  const precio =
    /\b(precio|cu[aá]nto|vale|está|cotizaci[oó]n|d[oó]lar|soja|ma[ií]z|novillo|trigo|cebada|girasol)\b/;
  if (precio.test(t)) {
    out.intencion = "precio";
    out.confianza = "media";
    return out;
  }

  return out;
};

const normalizarClasificacion = (obj) => {
  const base = defaultsClasificacion();
  if (!obj || typeof obj !== "object") return base;
  let intencion = String(obj.intencion || "agro_general").trim();
  if (!INTENCIONES.has(intencion)) intencion = "agro_general";
  const comandoIa =
    obj.comandoIa && typeof obj.comandoIa === "object" && obj.comandoIa.comando
      ? {
          comando: String(obj.comandoIa.comando || "").trim(),
          parametros:
            typeof obj.comandoIa.parametros === "object" && obj.comandoIa.parametros
              ? { ...obj.comandoIa.parametros }
              : {},
        }
      : null;

  return {
    ...base,
    intencion,
    cultivo: obj.cultivo != null ? String(obj.cultivo).trim() || null : null,
    producto: obj.producto != null ? String(obj.producto).trim() || null : null,
    zona_mencionada: obj.zona_mencionada != null ? String(obj.zona_mencionada).trim() || null : null,
    requiere_datos_propios: Boolean(obj.requiere_datos_propios),
    confianza: ["alta", "media", "baja"].includes(obj.confianza) ? obj.confianza : "media",
    comandoIa,
    variante_precio: obj.variante_precio != null ? String(obj.variante_precio).trim() || null : null,
    ayuda_recurso: obj.ayuda_recurso != null ? String(obj.ayuda_recurso).trim() || null : null,
    meta_consulta: obj.meta_consulta != null ? String(obj.meta_consulta).trim() || null : null,
  };
};

/**
 * Detecta preguntas/comentarios meta-conversacionales que **no** son
 * comandos del bot (aunque el LLM clasificador a veces los marca como
 * tal). Ejemplos típicos de la sesión 2026-05-12:
 *
 *   - "Sos un agente o un Chatbot?"
 *   - "De qué trata agroHabilis?"
 *   - "Tengo recomendaciones para hacerte"
 *   - "Quiero saber si eso se puede hacer en esta app"
 *   - "Pero todavía no te las dí"
 *   - "Y con respecto al registro?"
 *
 * Todos estos terminan con respuestas robóticas tipo "No reconocí el
 * comando..." si el clasificador los manda a `comando` y `rutaComando`
 * no encuentra ningún match concreto.
 *
 * Esta función devuelve `true` SOLO si el texto es claramente
 * conversacional/meta y NO contiene ningún disparador real de comando.
 */
const esPreguntaMetaConversacional = (texto = "") => {
  const original = String(texto || "").trim();
  if (!original) return false;
  /** Mensajes con número (suelen ser cargas) no son meta-charla. */
  if (/\d/.test(original)) return false;
  const t = norm(original);
  /** Si menciona explícitamente un comando del catálogo, NO es meta-charla. */
  const disparadoresComandoExplicito = /\b(mi\s+resumen|mis\s+alertas|mi\s+margen|mis\s+gastos|mis\s+ventas|ver\s+comandos|completar\s+perfil|mi\s+plan|planes|quiero\s+plan\s+(pro|basico|gratis)|alerta|avisa(me|r)|cancelar\s+alerta|reset\s+onboarding|mi\s+ganado|mi\s+zona|mis\s+cultivos|borrar\s+mis\s+datos)\b/;
  if (disparadoresComandoExplicito.test(t)) return false;
  /**
   * Patrones meta: preguntas sobre el bot, comentarios al bot, frases
   * conversacionales sin pedido operativo concreto. Mantenemos la lista
   * acotada y explícita para no pisar pedidos reales.
   */
  const patronesMeta = [
    /\bsos\s+(un\s+)?(agente|bot|chat\s*bot|asistente|ia|inteligencia\s+artificial|robot|humano|persona)\b/,
    /\bya\s+sos\s+(un\s+)?(agente|bot|asistente|ia)\b/,
    /\bde\s+qu[eé]\s+(trata|se\s+trata|va|hace|sirve)/,
    /\bqu[eé]\s+(es|hace|sos|hac[eé]s|pod[eé]s\s+hacer|sab[eé]s\s+hacer)\b/,
    /\bpara\s+qu[eé]\s+(sirv|sos|est[aá])/,
    /\bc[oó]mo\s+(funcion|te\s+llamas|te\s+llam[aá]s|trabaj[aá]s|me\s+ayud[aá]s)/,
    /\btengo\s+(recomendacion|sugerencia|critica|cr[ií]tica|comentario|pregunta|consult|duda)/,
    /\b(te\s+quer[ií]a|quer[ií]a)\s+(decir|comentar|preguntar|consultar|hacer)/,
    /\b(te\s+)?dec[ií]a\s+que\b/,
    /\bquiero\s+(saber|entender|ver|aprender)\s+(si|c[oó]mo|qu[eé]|cu[aá]ndo|d[oó]nde)\b/,
    /\beso\s+se\s+puede\s+(hacer|usar)\b/,
    /\bse\s+puede\s+hacer\s+(en\s+)?(esta|esa|la)\s+(app|aplicacion|aplicación|plataforma|web|herramienta)\b/,
    /\bpero\s+todav[ií]a\s+no\b/,
    /\bpod[eé]s\s+(guardar|procesar|cargar|manejar)\s+(todo|varios|muchos|juntos|a\s+la\s+vez)/,
    /\bme\s+contest[aá]s\s+como\s+un?\s+robot\b/,
    /\bpor\s+qu[eé]\s+(me\s+)?(contest|respond)/,
    /\bes\s+un\s+(bot|robot|asistente|chat\s*bot|agente)\b/,
    /^y\s+(con\s+)?respecto\s+(a|al|del|de|a\s+(la|los|las))\b/,
    /^y\s+(sobre|acerca\s+de|en\s+cuanto\s+a)\b/,
    /^y\s+(el|la|los|las)\s+\w{3,}\s*\??$/,
  ];
  return patronesMeta.some((re) => re.test(t));
};

const formatearHistorialParaClasificador = (historial = []) => {
  const filas = Array.isArray(historial) ? historial.slice(0, 5) : [];
  if (!filas.length) return "";
  /** Más antiguo arriba, último intercambio abajo (lo más relevante para el seguimiento). */
  const ordenado = [...filas].reverse();
  const lineas = ordenado.map((row, i) => {
    const p = String(row?.pregunta || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const r = String(row?.respuesta || "").replace(/\s+/g, " ").trim().slice(0, 220);
    return [`(Turno ${i + 1}) Usuario: ${p}`, `(Turno ${i + 1}) Asistente: ${r}`].join("\n");
  });
  return lineas.join("\n\n");
};

const clasificarMensaje = async (mensaje, usuario, opciones = {}) => {
  const listaEtiquetas = ETIQUETAS_INTENCION_PROMPT.map((e, i) => `${i + 1}. \`${e}\``).join("\n");
  const historialTxt = formatearHistorialParaClasificador(opciones?.historial || []);
  const bloqueHistorial = historialTxt
    ? `\n## Conversación previa en este mismo chat (más antiguo arriba)\n${historialTxt}\n\n### Cómo usar el historial\n- Si el mensaje nuevo es **corto o ambiguo** ("y el resto?", "podés procesar varios a la vez?", "y mañana?"), interpretalo **como seguimiento del mismo tema** del último turno (precio del cultivo X, registro de inventario, alerta, etc.) y elegí esa intención.\n- Si el último turno fue un **pedido de carga al inventario** y el mensaje nuevo dice "varios", "el resto", "los otros", "todos juntos" → casi seguro la intención es \`registrar\`.\n- No cambies el tema salvo que el usuario lo aclare con palabras explícitas de otro dominio.`
    : "";
  const prompt = `
## Tarea
Leé el **MENSAJE** del productor y decidí **cuál de las intenciones de la lista cerrada** describe mejor lo que quiere hacer **en este mensaje**. Tenés que elegir **exactamente una** etiqueta: copiá el identificador tal cual (mismo texto, sin mayúsculas inventadas ni sinónimos).

## Contexto del perfil (solo para ayudarte a decidir)
- Cultivos declarados: ${(usuario?.cultivos || []).map((c) => c.cultivo).join(", ") || "no informados"}
- Tiene datos propios cargados (gastos/ventas/movimientos): ${usuario?.tiene_datos ? "sí" : "no"}
${bloqueHistorial}
## Lista cerrada de intenciones (elegí UNA; el JSON debe llevar esa misma cadena en \`intencion\`)
${listaEtiquetas}

### Categorías posibles (qué significa cada \`intencion\`)
Usá esta guía para mapear el mensaje a **una** etiqueta de la lista de arriba.

- \`precio\`: quiere saber un **precio o cotización puntual hoy** (soja, maíz, otro grano, dólar/MEP/blue, insumo, novillo u otra hacienda en pie como referencia de mercado, “¿cuánto está…?”).
- \`analisis_mercado\`: quiere **interpretar el mercado** o **decidir** (vender/esperar, tendencia, spread, MATBA, logística comercial, etc.) **sin** apoyarse en “mis costos”, “mis hectáreas” ni datos que solo él tiene cargados.
- \`analisis_interno\`: quiere un análisis que **cruza mercado con sus propios datos del campo** (costos por ha, margen con sus gastos/ventas, “con mis números”, “me da con lo que tengo cargado”, etc.).
- \`clima\`: pregunta sobre **tiempo, lluvia esperada, helada, temperatura, pronóstico** para planificar (futuro o “¿va a llover?”). **No** uses esta etiqueta si en realidad está **registrando** un hecho (ej. “llovió 35 mm”, “puse vacas en el campo el caimán”: eso suele ser \`registrar\`).
- \`registrar\`: quiere **cargar o actualizar un dato nuevo** en el sistema: gasto, venta, animal o inventario, lluvia caída, labor/aplicación/siembra, stock, etc. (verbos tipo: gasté, compré, vendí, registrá, puse, agregué, cargué, nació, vacuné, llovió… con contenido concreto).
- \`consulta_registros\`: quiere **consultar datos que él mismo cargó antes** (cuánto gasté, mis ventas, inventario, animales en total, qué hay en un lote, etc.).
- \`agro_general\`: pregunta de **conocimiento agro** (técnica, cultivo, norma, “qué es el FAS”, épocas de siembra en general, etc.) **sin** pedir precio puntual ni análisis de mercado personalizado ni comando del bot.
- \`no_agro\`: pregunta que **no tiene que ver con el agro** operativo del productor (cultura general, deportes, etc.).
- \`saludo\`: **saludo, despedida o agradecimiento** sin un pedido concreto de datos o acción en el mismo mensaje (o el pedido es trivialmente social).
- \`small_talk\`: **charla breve sin pedido operativo** (estados de ánimo: "tengo sueño", "qué frío"; confirmaciones cortas como "dale", "perfecto"; risas, etc.). Diferencia con \`saludo\`: no es saludo/despedida, pero tampoco trae un pedido concreto. Si hay números o tema agro operativo, **no** uses small_talk.
- \`comando\`: pide ejecutar una **función explícita del bot** (MI RESUMEN, MIS ALERTAS, MI MARGEN, PLANES, VER COMANDOS, “avisame cuando la soja supere X”, etc.).

### Desempates (muy importante)
- Si el mensaje **carga o mueve datos** (cantidades, animales, insumos, lluvia ya caída en mm, “puse X vacas en el campo/lote Y”) → preferí **\`registrar\`** sobre \`clima\` o \`agro_general\`, aunque mencione un nombre que suene a localidad geográfica (puede ser nombre de lote).
- Si pide **pronóstico o “va a llover”** sin estar anotando un hecho pasado → \`clima\`.
- Si encajan dos etiquetas, elegí la **más específica** al acto principal (p. ej. registrar > agro_general).

## MENSAJE a clasificar
"""${String(mensaje || "").replace(/"/g, '\\"')}"""

## Respuesta requerida
Armá el objeto según el **MENSAJE a clasificar** (no copies literal el ejemplo si no aplica). En \`intencion\` poné **una sola** cadena **idéntica** a una de la lista numerada del principio.
Devolvé **solo** el JSON (sin markdown, sin texto fuera del objeto):
{
  "intencion": "precio",
  "cultivo": null,
  "producto": null,
  "zona_mencionada": null,
  "requiere_datos_propios": false,
  "confianza": "media",
  "variante_precio": null
}

Campos extra:
- Si la consulta es **solo** tipo de cambio (sin cultivos/granos en la misma pregunta): \`variante_precio\`: "dolar".
- Si pregunta **insumos** (urea, glifosato, semillas, fertilizantes): \`producto\`: "insumo".
- Si pregunta **hacienda en pie** para precio o decisión de compra/venta: \`producto\`: "hacienda".
`.trim();

  try {
    const raw = await llamarIAClasificador(prompt);
    let c = normalizarClasificacion(parsearJSON(raw));
    /**
     * Guardrail: si el LLM marcó `comando` pero el mensaje es claramente
     * una pregunta meta-conversacional (sin disparador de comando real
     * en el texto), lo degradamos a `agro_general` para que el pipeline
     * conversacional lo conteste con tono natural en vez de cortar con
     * "No reconocí el comando...". Ver `esPreguntaMetaConversacional`
     * para el detalle de patrones (origen: sesión 2026-05-12).
     */
    if (c.intencion === "comando" && esPreguntaMetaConversacional(mensaje)) {
      c = {
        ...c,
        intencion: "agro_general",
        confianza: c.confianza || "media",
        _guardrailMetaConversacional: true,
      };
    }
    return aplicarRefuerzoRegistroInventario(mensaje, c);
  } catch (e) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        clasificadorFallbackUsaHeuristica()
          ? "[clasificador] fallback heurístico:"
          : "[clasificador] IA agotada, fallback agro_general (CLASSIFIER_FALLBACK=heuristica para heurística):",
        e.message
      );
    }
    if (clasificadorFallbackUsaHeuristica()) {
      const c = normalizarClasificacion(clasificarHeuristica(mensaje));
      return aplicarRefuerzoRegistroInventario(mensaje, c);
    }
    const c = fallbackClasificacionIaAgotada();
    return aplicarRefuerzoRegistroInventario(mensaje, c);
  }
};

module.exports = {
  clasificarMensaje,
  llamarIAClasificador,
  parsearJSON,
  clasificarHeuristica,
  normalizarClasificacion,
  aplicarRefuerzoRegistroInventario,
  aplicarRefuerzoSeguimientoHistorial,
  esPreguntaMetaConversacional,
  INTENCIONES,
  ETIQUETAS_INTENCION_PROMPT,
};
