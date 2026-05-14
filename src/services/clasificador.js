"use strict";

/**
 * # Clasificador de intenciones — rol en la arquitectura de agente
 *
 * Este módulo NO es la fuente de verdad absoluta del turno. Es la **primera
 * capa** de un pipeline tipo agente (Cursor / tool-use):
 *
 *   1) **Clasificador con LLM** (Groq → Gemini): el modelo elige una
 *      etiqueta cerrada con reglas explícitas en el prompt (incluye
 *      desempates: capacidades del producto → `agro_general`, datos
 *      propios → `consulta_registros`, etc.). **No** escalamos con listas
 *      infinitas de frases en regex: una sola señal léxica amplia
 *      (`parecePreguntaCapacidadOMetaFeedback`) corrige solo el error
 *      sistemático cuando el LLM marca `comando` o `consulta_registros`
 *      para preguntas de capacidad / feedback al bot.
 *
 *   2) Verificación con LLM (post-clasificación, **sin regex de continuidad**)
 *      - Si hay historial reciente, un **segundo pase** pide al modelo que
 *        valide si la intención encaja con el hilo (precio → "y el novillo?",
 *        inventario pendiente → "y el resto?", etc.). Es razonamiento en
 *        lenguaje natural, no listas de patrones en código.
 *      - Desactivar: `CLASIFICADOR_VERIFY_HISTORIAL=0`.
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
 * **Por qué no IA libre en todo el canal:** latencia, costo y pasos que
 * exigen determinismo (comandos literales `MI RESUMEN`, confirmaciones
 * `SI/NO`). El LLM trabaja libre en scout y router; acá se pide
 * **una etiqueta de ruta** (1er pase) + **verify opcional con historial**
 * (2do pase, desactivable) + guardrail léxico mínimo para meta/capacidad.
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

/**
 * Comandos literales del catálogo: si aparecen, NO tratamos el mensaje
 * como meta-charla ni como "pregunta de capacidad" genérica.
 */
const RE_DISPARADORES_COMANDO_EXPLICITO =
  /\b(mi\s+resumen|mis\s+alertas|mi\s+margen|mis\s+gastos|mis\s+ventas|ver\s+comandos|completar\s+perfil|mi\s+plan|planes|quiero\s+plan\s+(pro|basico|gratis)|alerta|avisa(me|r)|cancelar\s+alerta|reset\s+onboarding|mi\s+ganado|mi\s+zona|mis\s+cultivos|borrar\s+mis\s+datos)\b/;

/**
 * **Un solo** guardrail léxico amplio (no una lista infinita de frases):
 * modalidad de permiso / app, feedback de desacuerdo con el asistente,
 * o pregunta sobre capacidad de datos (individualizar, trazabilidad).
 *
 * Se usa después del LLM para corregir `comando` o `consulta_registros`
 * mal elegidos, y dentro de `esPreguntaMetaConversacional` vía OR.
 * La decisión fina la hace el modelo en el prompt; esto solo evita
 * respuestas tipo "sin datos en base" cuando el usuario pregunta *si puede*.
 */
const parecePreguntaCapacidadOMetaFeedback = (texto = "") => {
  const t = norm(texto);
  if (!t) return false;
  if (RE_DISPARADORES_COMANDO_EXPLICITO.test(t)) return false;
  return /\b(?:puedo|podemos|pod[eé]s|podria|podr[ií]a|se\s+puede|se\s+pueden|es\s+posible|permite|sirve\s+para|la\s+app|esta\s+app|agrohabilis|individualiz|identificar\s+cada|trazabilidad|no\s+(?:me\s+)?entend\w*|entendiste\s+mal|equivocaste|no\s+es\s+(?:eso|lo)\s+que|no\s+era\b|pregunt(?:o|aba|ando)\s+otra\s+cosa|no\s+te\s+estoy\s+pregunt|tiene\s+que\s+ser\s+otro|me\s+equivoc\w*|otro\s+(?:indice|valor|precio|dato|numero)|ese\s+no\s+es)\b/.test(
    t
  );
};

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
 * Preferencia: Groq → Gemini → fallo. `system` y `maxTokens` configurables
 * (clasificador principal vs verificador de coherencia con historial).
 */
const llamarIAClasificadorConSystem = async (system, promptCompleto, maxTokens) => {
  const mt = Number(maxTokens || process.env.CLASIFICADOR_MAX_TOKENS || 100);
  if (process.env.GROQ_API_KEY?.trim()) {
    try {
      const { texto } = await generarChatGroq({
        system,
        user: promptCompleto,
        maxTokens: mt,
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

const llamarIAClasificador = async (promptCompleto) => {
  const system = [
    "Sos el clasificador de intenciones de AgroHabilis (productores argentinos por WhatsApp).",
    "Leé el mensaje del usuario y elegí UNA sola etiqueta de intención entre las que te lista el usuario en el prompt (vocabulario cerrado).",
    "El valor de intencion debe ser literalmente una de las etiquetas listadas en el user (misma cadena; no un sinónimo).",
    "Respondé EXCLUSIVAMENTE un objeto JSON válido (sin markdown, sin texto antes ni después).",
  ].join(" ");
  return llamarIAClasificadorConSystem(system, promptCompleto, Number(process.env.CLASIFICADOR_MAX_TOKENS || 100));
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
 * Meta-charla: sobre el bot, la app, o señal amplia de capacidad / feedback
 * (`parecePreguntaCapacidadOMetaFeedback`). **No** listamos frase por frase
 * infinitas: el LLM clasifica y este OR cubre el error sistemático
 * comando/consulta_registros vs pregunta de producto.
 */
const esPreguntaMetaConversacional = (texto = "") => {
  const original = String(texto || "").trim();
  if (!original) return false;
  const t = norm(original);
  if (RE_DISPARADORES_COMANDO_EXPLICITO.test(t)) return false;
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
  const fromList = patronesMeta.some((re) => re.test(t));
  if (fromList) return true;
  if (parecePreguntaCapacidadOMetaFeedback(texto)) return true;
  return false;
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

const verifyHistorialHabilitado = () => {
  const v = String(process.env.CLASIFICADOR_VERIFY_HISTORIAL || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
};

/**
 * Segundo pase **solo LLM**: valida si la intención elegida encaja con el
 * hilo del chat (seguimiento de precio, de inventario, etc.). Sin refuerzos
 * regex en código; el modelo razona sobre el texto del historial.
 *
 * `overrides.llamarVerificador(system, user, maxTokens)` → texto JSON (tests).
 */
const verificarCoherenciaIntencionConHistorialLLM = async (
  mensaje,
  clasificacion,
  historial,
  overrides = {}
) => {
  if (!verifyHistorialHabilitado()) return clasificacion;
  if (!clasificacion || typeof clasificacion !== "object") return clasificacion;
  const hist = Array.isArray(historial)
    ? historial.filter((x) => x && (x.pregunta != null || x.respuesta != null)).slice(0, 5)
    : [];
  if (!hist.length) return clasificacion;

  const historialTxt = formatearHistorialParaClasificador(hist);
  if (!String(historialTxt || "").trim()) return clasificacion;

  const listaEtiquetas = ETIQUETAS_INTENCION_PROMPT.map((e, i) => `${i + 1}. \`${e}\``).join("\n");

  const system = [
    "Sos un verificador de coherencia para AgroHabilis (WhatsApp, productores argentinos).",
    "Recibís el historial reciente, un NUEVO mensaje del usuario y una intención ya elegida por otro modelo.",
    "Decidí si esa intención encaja con el hilo conversacional.",
    "Si el asistente acababa de dar cotizaciones o precios de mercado y el usuario pregunta corto por otro producto (ej. «¿y el novillo?», «y el maíz?») → suele seguir siendo `precio`, no `consulta_registros` ni `registrar`.",
    "Si el asistente estaba en carga o confirmación de inventario y el usuario dice «y el resto», «los demás», «agregamos…» → suele ser `registrar`.",
    "Si la intención propuesta ya es razonable para el hilo, respondé coherente true.",
    "Respondé EXCLUSIVAMENTE JSON: {\"coherente\":true} o {\"coherente\":false,\"intencion\":\"...\",\"motivo\":\"breve\"}. Si coherente es false, intencion debe ser exactamente una de las etiquetas listadas en el user (misma cadena).",
  ].join(" ");

  const prompt = `
## Etiquetas válidas (solo una si corregís)
${listaEtiquetas}

## Historial reciente (más antiguo arriba)
${historialTxt}

## Nuevo mensaje del usuario
"""${String(mensaje || "").replace(/"/g, '\\"')}"""

## Intención propuesta
${JSON.stringify({ intencion: clasificacion.intencion })}
`.trim();

  const maxV = Number(process.env.CLASIFICADOR_VERIFY_MAX_TOKENS || 120);
  try {
    let raw;
    if (typeof overrides.llamarVerificador === "function") {
      raw = await overrides.llamarVerificador(system, prompt, maxV);
    } else {
      raw = await llamarIAClasificadorConSystem(system, prompt, maxV);
    }
    const obj = parsearJSON(String(raw || "").trim());
    if (obj && obj.coherente === true) return clasificacion;
    const nueva = String(obj?.intencion || "").trim();
    if (!INTENCIONES.has(nueva)) return clasificacion;
    return {
      ...clasificacion,
      intencion: nueva,
      confianza: clasificacion.confianza || "media",
      _verifyHistorialRetry: true,
      _verifyMotivo: String(obj?.motivo || "").slice(0, 240),
    };
  } catch (_e) {
    return clasificacion;
  }
};

const clasificarMensaje = async (mensaje, usuario, opciones = {}) => {
  const listaEtiquetas = ETIQUETAS_INTENCION_PROMPT.map((e, i) => `${i + 1}. \`${e}\``).join("\n");
  const historialTxt = formatearHistorialParaClasificador(opciones?.historial || []);
  const bloqueHistorial = historialTxt
    ? `\n## Conversación previa en este mismo chat (más antiguo arriba)\n${historialTxt}\n\n### Cómo usar el historial\n- Si el mensaje nuevo es **corto o ambiguo** ("y el resto?", "podés procesar varios a la vez?", "y mañana?"), interpretalo **como seguimiento del mismo tema** del último turno (precio del cultivo X, registro de inventario, alerta, etc.) y elegí esa intención.\n- Si el último turno fue un **pedido de carga al inventario** y el mensaje nuevo dice "varios", "el resto", "los otros", "todos juntos" → casi seguro la intención es \`registrar\`.\n- Si el último turno del Asistente **respondió un precio o cotización** (símbolo \`$\`, \`/tn\`, BCR, Liniers, Matba, "tendencia alcista", etc.) y el mensaje nuevo es un seguimiento corto que menciona **otro producto cotizable** ("y el novillo?", "y el maíz?", "y el dólar?", "y la cebada?") → la intención es \`precio\` (NO \`consulta_registros\` ni \`registrar\`, aunque el nombre del producto coincida con una categoría de inventario).\n- No cambies el tema salvo que el usuario lo aclare con palabras explícitas de otro dominio.`
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
- \`consulta_registros\`: quiere **consultar datos que él mismo cargó antes** (cuánto gasté, mis ventas, inventario, animales en total, qué hay en un lote, etc.). **NO** uses esta etiqueta si pregunta **si la app/herramienta permite** algo (p. ej. "¿puedo individualizar cada cabeza?", "¿se puede registrar por lote?", "¿después puedo identificar cada novillo?"): eso es **\`agro_general\`** (pregunta sobre el producto, no un listado de sus datos guardados).
- \`agro_general\`: conocimiento agro **o** pregunta sobre **qué puede hacer AgroHabilis** (límites del registro, si admite trazabilidad animal, flujos, "¿puedo…?", "¿se puede…?"), **o** cuando el usuario **corrige** al asistente ("no me entendiste", "te pregunto otra cosa", "no es eso lo que pregunté"). **No** uses esta etiqueta si está **cargando datos concretos** (cantidades, animales, etc.): ahí suele ser \`registrar\`.
- \`no_agro\`: pregunta que **no tiene que ver con el agro** operativo del productor (cultura general, deportes, etc.).
- \`saludo\`: **saludo, despedida o agradecimiento** sin un pedido concreto de datos o acción en el mismo mensaje (o el pedido es trivialmente social).
- \`small_talk\`: **charla breve sin pedido operativo** (estados de ánimo: "tengo sueño", "qué frío"; confirmaciones cortas como "dale", "perfecto"; risas, etc.). Diferencia con \`saludo\`: no es saludo/despedida, pero tampoco trae un pedido concreto. Si hay números o tema agro operativo, **no** uses small_talk.
- \`comando\`: pide ejecutar una **función explícita del bot** (MI RESUMEN, MIS ALERTAS, MI MARGEN, PLANES, VER COMANDOS, “avisame cuando la soja supere X”, etc.).

### Desempates (muy importante)
- Si el mensaje pregunta **solo** «¿qué día es hoy?», «¿qué fecha es?», «¿qué hora es?» (calendario civil, sin mercado) → \`agro_general\` y en el JSON incluí \`"meta_consulta": "fecha"\` o \`"hora"\` según corresponda (además el pipeline fusiona \`meta_fecha\` / \`meta_hora\` del detector rápido).
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
  "variante_precio": null,
  "meta_consulta": null
}

Campos extra:
- Si la consulta es **solo** «¿qué día es hoy?» / «¿qué fecha es?»: \`meta_consulta\`: "fecha". Si **solo** «¿qué hora es?»: \`meta_consulta\`: "hora". Si no aplica: null.
- Si la consulta es **solo** tipo de cambio (sin cultivos/granos en la misma pregunta): \`variante_precio\`: "dolar".
- Si pregunta **insumos** (urea, glifosato, semillas, fertilizantes): \`producto\`: "insumo".
- Si pregunta **hacienda en pie** para precio o decisión de compra/venta: \`producto\`: "hacienda".
`.trim();

  try {
    const raw = await llamarIAClasificador(prompt);
    let c = normalizarClasificacion(parsearJSON(raw));
    /**
     * Guardrail post-LLM: el modelo elige la intención; si equivocó a
     * `comando` o `consulta_registros` para una pregunta meta / de
     * capacidad del producto / feedback al bot, degradamos a
     * `agro_general`. La detección usa `esPreguntaMetaConversacional`
     * (lista corta de charla sobre el bot + **un solo** léxico amplio
     * `parecePreguntaCapacidadOMetaFeedback`, no frase por frase).
     */
    if ((c.intencion === "comando" || c.intencion === "consulta_registros") && esPreguntaMetaConversacional(mensaje)) {
      c = {
        ...c,
        intencion: "agro_general",
        confianza: c.confianza || "media",
        _guardrailMetaConversacional: true,
      };
    }
    c = await verificarCoherenciaIntencionConHistorialLLM(mensaje, c, opciones?.historial || [], {
      llamarVerificador: opciones?.llamarVerificadorClasificador,
    });
    return c;
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
      return normalizarClasificacion(clasificarHeuristica(mensaje));
    }
    return fallbackClasificacionIaAgotada();
  }
};

module.exports = {
  clasificarMensaje,
  llamarIAClasificador,
  llamarIAClasificadorConSystem,
  parsearJSON,
  clasificarHeuristica,
  normalizarClasificacion,
  verificarCoherenciaIntencionConHistorialLLM,
  esPreguntaMetaConversacional,
  parecePreguntaCapacidadOMetaFeedback,
  INTENCIONES,
  ETIQUETAS_INTENCION_PROMPT,
};
