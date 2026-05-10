const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const { generarChatOpenRouter } = require("./openrouter");
const { generarChatGroq } = require("./groq");
const fs = require("fs");
const path = require("path");

const getModelName = () =>
  process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";

let fuentesCache = { mtimeMs: 0, texto: "" };
let fuentesCuradasCache = { mtimeMs: 0, texto: "" };
let guiaRespuestasCache = { mtimeMs: 0, texto: "" };
let casosEntrenamientoCache = { mtimeMs: 0, texto: "" };
const FUENTES_PATH = path.join(__dirname, "..", "..", "docs", "fuentes", "fuentes.md");
const FUENTES_CURADAS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "fuentes",
  "fuentes-curadas.md"
);
const GUIA_RESPUESTAS_PATH = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "contexto-ia",
  "guia-respuestas.md"
);
const CASOS_ENTRENAMIENTO_PATH = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "operacion",
  "casos-entrenamiento.md"
);

const leerMarcoFuentes = () => {
  try {
    const st = fs.statSync(FUENTES_PATH);
    if (fuentesCache.texto && fuentesCache.mtimeMs === st.mtimeMs) {
      return fuentesCache.texto;
    }
    const raw = fs.readFileSync(FUENTES_PATH, "utf8");
    const lines = String(raw || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 80);
    const texto = lines.join("\n");
    fuentesCache = { mtimeMs: st.mtimeMs, texto };
    return texto;
  } catch (_e) {
    return "";
  }
};

const leerMarcoArchivo = ({ cache, setCache, filePath, maxLines = 80 }) => {
  try {
    const st = fs.statSync(filePath);
    if (cache.texto && cache.mtimeMs === st.mtimeMs) {
      return cache.texto;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = String(raw || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, maxLines);
    const texto = lines.join("\n");
    setCache({ mtimeMs: st.mtimeMs, texto });
    return texto;
  } catch (_e) {
    return "";
  }
};

const leerMarcoFuentesCuradas = () =>
  leerMarcoArchivo({
    cache: fuentesCuradasCache,
    setCache: (v) => {
      fuentesCuradasCache = v;
    },
    filePath: FUENTES_CURADAS_PATH,
    maxLines: 120,
  });

const leerGuiaRespuestas = () =>
  leerMarcoArchivo({
    cache: guiaRespuestasCache,
    setCache: (v) => {
      guiaRespuestasCache = v;
    },
    filePath: GUIA_RESPUESTAS_PATH,
    maxLines: 140,
  });

const leerCasosEntrenamiento = () =>
  leerMarcoArchivo({
    cache: casosEntrenamientoCache,
    setCache: (v) => {
      casosEntrenamientoCache = v;
    },
    filePath: CASOS_ENTRENAMIENTO_PATH,
    maxLines: 160,
  });

const construirSystemBase = (system = "") => {
  const marcoFuentes = leerMarcoFuentes();
  const marcoFuentesCuradas = leerMarcoFuentesCuradas();
  const guiaRespuestas = leerGuiaRespuestas();
  const casosEntrenamiento = leerCasosEntrenamiento();
  const reglas = [
    "POLITICA OBLIGATORIA AGROHABILIS:",
    "- Basate primero en datos de la base interna/contexto recibido; no inventes valores.",
    "- Si un dato no aparece en el contexto que recibís (JSON/campos explícitos), decí exactamente: 'sin datos en base'. Si el contexto ya trae precio, fecha o fuente para ese punto, no digas que falta.",
    "- No inventes nombres de asistente, slogans ni texto comercial.",
    "- Cuando cites un dato factual, incluye fecha y fuente si está disponible en el contexto.",
  ].join("\n");
  const marco = marcoFuentes
    ? `\n\nMarco de fuentes (docs/fuentes/fuentes.md, usar como referencia de cobertura y procedencia):\n${marcoFuentes}`
    : "";
  const marcoCurado = marcoFuentesCuradas
    ? `\n\nFuentes priorizadas (docs/fuentes/fuentes-curadas.md):\n${marcoFuentesCuradas}`
    : "";
  const marcoGuia = guiaRespuestas
    ? `\n\nGuia de respuesta operativa (docs/contexto-ia/guia-respuestas.md):\n${guiaRespuestas}`
    : "";
  const marcoCasos = casosEntrenamiento
    ? `\n\nCasos de entrenamiento (docs/operacion/casos-entrenamiento.md):\n${casosEntrenamiento}`
    : "";
  return `${reglas}\n\n${String(system || "").trim()}${marco}${marcoCurado}${marcoGuia}${marcoCasos}`.trim();
};

const recortarTextoIA = (texto = "", maxChars = 12000) => {
  const t = String(texto || "");
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n\n[contexto_recortado_por_tamano]`;
};

const getIaTimeoutMs = () => {
  const n = Number(process.env.IA_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 15000;
};

const getGeminiRetries = () => {
  const n = Number(process.env.GEMINI_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
};

const getGeminiRetryBaseMs = () => {
  const n = Number(process.env.GEMINI_RETRY_BASE_MS);
  return Number.isFinite(n) && n > 0 ? n : 800;
};

const getGroundingModel = () =>
  process.env.GEMINI_GROUNDING_MODEL?.trim() || getModelName();

const getGroundingMaxChars = () => {
  const n = Number(process.env.GEMINI_GROUNDING_MAX_CHARS);
  return Number.isFinite(n) && n > 200 ? Math.floor(n) : 1000;
};

const getGroundingTimeoutMs = () => {
  const n = Number(process.env.GEMINI_GROUNDING_TIMEOUT_MS);
  const base = getIaTimeoutMs();
  return Number.isFinite(n) && n > base ? n : base + 12000;
};

const extraerTextoYCandidato = (data) => {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;
  const texto = Array.isArray(parts)
    ? parts.map((p) => String(p?.text || "")).join("").trim()
    : "";
  return { texto, candidate: cand };
};

const extraerUrlsGrounding = (candidate) => {
  const gm = candidate?.groundingMetadata || candidate?.grounding_metadata;
  if (!gm) return { urls: [], queries: [] };
  const chunks = gm.groundingChunks || gm.grounding_chunks || [];
  const urls = chunks
    .map((c) => c?.web?.uri || c?.web?.url)
    .filter((u) => typeof u === "string" && u.startsWith("http"));
  const queries = gm.webSearchQueries || gm.web_search_queries || [];
  return { urls: [...new Set(urls)].slice(0, 10), queries: Array.isArray(queries) ? queries.slice(0, 8) : [] };
};

/**
 * Búsqueda web vía Gemini (Google Search grounding). Costo distinto al generateContent simple.
 * Intenta REST v1beta con `google_search`; si falla, SDK con `googleSearchRetrieval`.
 */
const generarConGroundingGoogleSearch = async ({ prompt, contextLabel = "IA.grounding" }) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");
  if (!prompt) throw new Error("prompt vacío");

  const model = getGroundingModel();
  const ms = getGroundingTimeoutMs();
  const retries = getGeminiRetries();
  const baseMs = getGeminiRetryBaseMs();
  let lastError = null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  for (let intento = 0; intento <= retries; intento += 1) {
    try {
      const bodySearch = {
        contents: [{ role: "user", parts: [{ text: String(prompt) }] }],
        tools: [{ google_search: {} }],
      };
      const { data, status } = await axios.post(url, bodySearch, {
        params: { key: apiKey },
        timeout: ms,
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true,
      });
      if (status >= 400) {
        const errMsg = data?.error?.message || `HTTP ${status}`;
        const e = new Error(errMsg);
        e.response = { status };
        throw e;
      }
      if (data?.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
      }
      const { texto, candidate } = extraerTextoYCandidato(data);
      const { urls, queries } = extraerUrlsGrounding(candidate);
      if (texto) {
        return { texto, urls, queries, model, via: "rest_google_search" };
      }
      throw new Error("Gemini grounding: respuesta sin texto");
    } catch (error) {
      lastError = error;
      const reintentable = esErrorReintentableGemini(error);
      const esUltimo = intento >= retries;
      if (!reintentable || esUltimo) break;
      const delayMs = baseMs * 2 ** intento;
      console.warn(
        `[${contextLabel}] grounding REST fallo (intento ${intento + 1}/${retries + 1}): ${error.message}. Reintentando en ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const mdl = genAI.getGenerativeModel({
      model,
      tools: [{ googleSearchRetrieval: {} }],
    });
    const result = await conTimeout(
      mdl.generateContent({
        contents: [{ role: "user", parts: [{ text: String(prompt) }] }],
      }),
      ms,
      `${contextLabel}.sdk`
    );
    const response = result.response;
    const texto = String(response.text() || "").trim();
    const cand = response.candidates?.[0];
    const { urls, queries } = extraerUrlsGrounding(cand);
    if (!texto) throw lastError || new Error("Gemini grounding SDK: sin texto");
    return { texto, urls, queries, model, via: "sdk_googleSearchRetrieval" };
  } catch (e) {
    throw lastError || e;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const esErrorReintentableGemini = (error) => {
  const status = Number(error?.response?.status);
  if (status === 503 || status === 429) return true;
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("service unavailable") ||
    msg.includes("high demand") ||
    msg.includes("resource exhausted") ||
    msg.includes("timeout")
  );
};

/** Evita que el SDK de Gemini quede colgado sin límite (misma ventana que axios en Groq/OpenRouter). */
const conTimeout = async (promise, ms, label = "Gemini") => {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, limite]);
  } finally {
    clearTimeout(timer);
  }
};

const generarTexto = async (prompt, opts = {}) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no configurada");
  }

  const modelName = String(opts.model || getModelName()).trim();
  const ms =
    Number.isFinite(Number(opts.timeoutMs)) && Number(opts.timeoutMs) > 0
      ? Number(opts.timeoutMs)
      : getIaTimeoutMs();

  const genAI = new GoogleGenerativeAI(apiKey);
  const genCfg = {};
  if (Number.isFinite(Number(opts.maxOutputTokens)) && Number(opts.maxOutputTokens) > 0) {
    genCfg.maxOutputTokens = Math.floor(Number(opts.maxOutputTokens));
  }
  if (Number.isFinite(Number(opts.temperature))) {
    genCfg.temperature = Number(opts.temperature);
  }
  const modelOpts =
    Object.keys(genCfg).length > 0 ? { model: modelName, generationConfig: genCfg } : { model: modelName };
  const model = genAI.getGenerativeModel(modelOpts);
  const result = await conTimeout(model.generateContent(prompt), ms, "Gemini.generateContent");
  const texto = result.response.text();
  const usage = result.response.usageMetadata;
  const tokensUsados =
    typeof usage?.totalTokenCount === "number"
      ? usage.totalTokenCount
      : null;

  return { texto, tokensUsados, model: modelName };
};

const generarTextoConReintentos = async (prompt, contextLabel = "IA", opts = {}) => {
  const retries = getGeminiRetries();
  const baseMs = getGeminiRetryBaseMs();
  let lastError = null;

  for (let intento = 0; intento <= retries; intento += 1) {
    try {
      return await generarTexto(prompt, opts);
    } catch (error) {
      lastError = error;
      const reintentable = esErrorReintentableGemini(error);
      const esUltimo = intento >= retries;
      if (!reintentable || esUltimo) break;
      const delayMs = baseMs * 2 ** intento;
      console.warn(
        `[${contextLabel}] gemini fallo (intento ${intento + 1}/${retries + 1}): ${error.message}. Reintentando en ${delayMs}ms`
      );
      await sleep(delayMs);
    }
  }
  throw lastError || new Error("Gemini fallo sin detalle");
};

/**
 * Resumen post-sync BCR (job `pipelineDiario`): una sola llamada a Gemini (`generarTexto`).
 * No usa `generarConPromptLibre` ni IA_PROVIDER_ORDER; el chat sí usa esa cadena para consultas abiertas.
 */
const generarResumenMercado = async (textoContexto) => {
  const prompt = [
    "Sos un asistente agropecuario para productores argentinos.",
    "Genera un resumen breve (maximo 8 lineas) en espanol rioplatense.",
    "Prioriza claridad: cultivos, rangos o valores representativos, moneda (ARS/USD) y fecha.",
    "No inventes datos fuera del contexto. Si falta informacion, decilo explicitamente.",
    "",
    "Contexto:",
    textoContexto,
  ].join("\n");
  return generarTexto(prompt);
};

const getProviderOrder = () => {
  const raw = String(process.env.IA_PROVIDER_ORDER || "gemini,groq,openrouter")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const order = raw.filter((x) =>
    ["groq", "openrouter", "gemini"].includes(x)
  );
  return order.length ? order : ["gemini", "groq", "openrouter"];
};

const runProviderChain = async ({ system, user, contextLabel = "IA" }) => {
  const order = getProviderOrder();
  let lastError = null;
  const trace = [];

  for (const provider of order) {
    try {
      if (provider === "groq" && process.env.GROQ_API_KEY?.trim()) {
        const out = await generarChatGroq({ system, user });
        return { ...out, providerUsed: "groq", providerTrace: [...trace, { provider, ok: true }] };
      }
      if (provider === "openrouter" && process.env.OPENROUTER_API_KEY?.trim()) {
        const out = await generarChatOpenRouter({ system, user });
        return { ...out, providerUsed: "openrouter", providerTrace: [...trace, { provider, ok: true }] };
      }
      if (provider === "gemini" && process.env.GEMINI_API_KEY?.trim()) {
        const out = await generarTextoConReintentos(`${system}\n\n${user}`, contextLabel);
        return { ...out, providerUsed: "gemini", providerTrace: [...trace, { provider, ok: true }] };
      }
      trace.push({ provider, ok: false, error: "no_configurado" });
    } catch (error) {
      lastError = error;
      trace.push({ provider, ok: false, error: error.message });
      console.warn(`[${contextLabel}] ${provider} fallo:`, error.message);
    }
  }

  // Último intento Gemini aunque no esté en orden (mantiene compatibilidad).
  try {
    const out = await generarTextoConReintentos(`${system}\n\n${user}`, contextLabel);
    return { ...out, providerUsed: "gemini", providerTrace: [...trace, { provider: "gemini", ok: true, forced: true }] };
  } catch (e) {
    e.providerTrace = trace;
    throw lastError || e;
  }
};

const getIntentClassifierModel = () =>
  process.env.GEMINI_INTENT_MODEL?.trim() || process.env.INTENT_CLASSIFIER_MODEL?.trim() || "";

const getIntentClassifierTimeoutMs = () => {
  const n = Number(process.env.INTENT_CLASSIFIER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 60_000) : 8000;
};

const getIntentClassifierMaxOutputTokens = () => {
  const n = Number(process.env.INTENT_CLASSIFIER_MAX_OUTPUT_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 1024) : 256;
};

/**
 * Solo clasificación de intención: Gemini directo (sin cadena Groq/OpenRouter ni política fuentes.md).
 * Modelo: GEMINI_INTENT_MODEL o INTENT_CLASSIFIER_MODEL o GEMINI_MODEL.
 */
const generarClasificacionIntencion = async ({ system, user }) => {
  if (!system || !user) {
    throw new Error("Faltan system/user para generarClasificacionIntencion");
  }
  const prompt = `${String(system).trim()}\n\n${String(user).trim()}`;
  const model = getIntentClassifierModel() || getModelName();
  return generarTextoConReintentos(prompt, "IA.intent", {
    model,
    timeoutMs: getIntentClassifierTimeoutMs(),
    maxOutputTokens: getIntentClassifierMaxOutputTokens(),
    temperature: 0,
  });
};

const generarConPromptLibre = async ({ system, user }) => {
  if (!system || !user) {
    throw new Error("Faltan system/user para generarConPromptLibre");
  }
  const systemCompacto = recortarTextoIA(construirSystemBase(system), 7000);
  const userCompacto = recortarTextoIA(user, 12000);
  return runProviderChain({ system: systemCompacto, user: userCompacto, contextLabel: "IA" });
};

const generarRespuestaConsulta = async ({ contextoDatos, pregunta }) => {
  const systemPrompt = [
    "Sos el asistente de AgroHabilis, una herramienta de inteligencia",
    "agropecuaria para productores argentinos. Respondés consultas sobre",
    "precios de granos, clima y mercados de forma clara, directa y en",
    "lenguaje simple. No usás tecnicismos innecesarios. Siempre mencionás",
    "la fecha de los datos que estás usando. Si no tenés datos suficientes",
    "para responder, lo decís claramente.",
    "Si el JSON de contexto trae fecha_hoy_ar, usala como única fecha de 'hoy' en Argentina (no uses otra zona horaria ni el reloj interno).",
    "Si la consulta es de hacienda/ganaderia, respetá estrictamente las",
    "reglas metodologicas incluidas en marco_referencia_hacienda.",
    "",
    "Reglas obligatorias de respuesta:",
    "1) Solo afirmá datos factuales que existan en el contexto recibido.",
    "2) Cada afirmacion factual debe indicar fecha y fuente del contexto.",
    "3) Si no hay datos para responder una parte, decí textualmente: 'no tengo datos para eso'.",
    "4) Podés agregar orientacion general extra fuera de contexto SOLO si:",
    "   - no incluye datos numericos no verificados",
    "   - no contradice el contexto",
    "   - queda claramente marcada como recomendacion general.",
    "5) Nunca inventes valores, fechas, porcentajes ni citas de mercado.",
    "6) Paridad / cobertura: si el JSON trae al menos un disponible en ARS, un futuro MATBA en USD y un tipo de cambio MEP/bolsa, calculá el tipo de cambio implícito (ARS del spot / USD del futuro) y la brecha vs ese MEP; no respondas 'no tengo datos' ni 'sin datos en base' para eludir ese cálculo. Cerrá con 1-2 líneas de postura operativa prudente (tramos, esperar convergencia, etc.) sin cifras inventadas.",
    "7) Formato *WhatsApp*: *negrita* para títulos y cifras clave, _cursiva_ para matices, emojis al inicio de bloques (📌 💱 🌾) y línea ━━━━━━━━━━━━━━━━━━━━ entre secciones si hay más de un tema. No uses markdown ## ni **.",
    "",
    "Formato de salida obligatorio:",
    "- Respuesta breve y directa",
    "- Datos verificados: bullets con dato + fecha + fuente",
    "- Recomendacion general (opcional): 1-2 bullets sin datos no verificados",
    "- Si faltan datos: incluir 'no tengo datos para eso'",
    "",
    "Datos disponibles al momento de esta consulta:",
    contextoDatos,
  ].join("\n");

  const userContent = [
    `Consulta del productor:`,
    pregunta,
    "",
    "Respondé en español rioplatense, de forma directa.",
  ].join("\n");

  return runProviderChain({
    system: construirSystemBase(systemPrompt),
    user: `${userContent}\n\nRespuesta:`,
    contextLabel: "IA",
  });
};

/** Respuesta corta (p. ej. JSON de clasificación); Flash con techo de tokens. */
const generarTextoClasificadorRapido = async (prompt) => {
  const p = String(prompt || "").trim();
  if (!p) throw new Error("Falta prompt");
  return generarTextoConReintentos(p, "IA.clasificador", {
    maxOutputTokens: Number(process.env.CLASIFICADOR_MAX_OUT || 128),
    temperature: 0,
  });
};

module.exports = {
  generarConPromptLibre,
  generarClasificacionIntencion,
  generarResumenMercado,
  generarRespuestaConsulta,
  generarConGroundingGoogleSearch,
  getGroundingMaxChars,
  generarTextoClasificadorRapido,
};
