const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const { generarChatOpenRouter } = require("./openrouter");
const { generarChatGroq } = require("./groq");
const { ollamaHabilitado, generarChatOllama } = require("./ollama");
const fs = require("fs");
const path = require("path");
const { markFreeKeyAsFailed, iaRequestContext } = require("./gemini_keys");

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
    "- Si un dato no aparece en el contexto que recibís (JSON/campos explícitos), explicalo de forma sumamente empática, honesta y natural (usando voseo argentino), indicando qué referencia falta y sugiriendo la acción práctica más cercana. Queda terminantemente PROHIBIDO responder con frases robóticas o secas como 'sin datos en base' o 'referencia puntual no informada'.",
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
    let texto;
    try {
      texto = String(response.text() || "").trim();
    } catch (textErr) {
      throw new Error("Error al obtener texto de respuesta con grounding de Gemini: " + textErr.message);
    }
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
  const msg = String(error?.message || "").toLowerCase();
  const es429 = status === 429 || msg.includes("429") || msg.includes("resource exhausted") || msg.includes("quota");
  const es403 = status === 403 || msg.includes("403") || msg.includes("api_key_service_blocked");
  
  if (es429 || es403) {
    try {
      markFreeKeyAsFailed(true);
    } catch (e) {
      console.warn("[Gemini] Error conmutando clave a fallback:", e.message);
    }
  }
  if (status === 503 || status === 429 || status === 403) return true;
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
  if (typeof opts.responseMimeType === "string" && opts.responseMimeType.trim()) {
    genCfg.responseMimeType = opts.responseMimeType.trim();
  }
  const modelOpts = { model: modelName };
  if (Object.keys(genCfg).length > 0) {
    modelOpts.generationConfig = genCfg;
  }
  if (typeof opts.systemInstruction === "string" && opts.systemInstruction.trim()) {
    modelOpts.systemInstruction = opts.systemInstruction.trim();
  }
  const model = genAI.getGenerativeModel(modelOpts);
  const result = await conTimeout(model.generateContent(prompt), ms, "Gemini.generateContent");
  let texto;
  try {
    texto = result.response.text();
  } catch (textErr) {
    throw new Error("Error al obtener texto de respuesta de Gemini: " + textErr.message);
  }
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
 * Resumen post-sync BCR (job `pipelineDiario`): usa la cadena de proveedores.
 * Si Gemini está con cuota, pasa a Groq/OpenRouter/Ollama.
 */
const generarResumenMercado = async (textoContexto) => {
  const system = [
    "Sos un asistente agropecuario para productores argentinos.",
    "Genera un resumen breve (maximo 8 lineas) en espanol rioplatense.",
    "Prioriza claridad: cultivos, rangos o valores representativos, moneda (ARS/USD) y fecha.",
    "No inventes datos fuera del contexto. Si falta informacion, decilo explicitamente.",
  ].join("\n");
  const user = `Contexto:\n${textoContexto}`;
  return runProviderChain({ system, user, contextLabel: "IA.resumen" });
};

/**
 * Orden de proveedores parametrizable por variable de entorno.
 * @param {string} [orderEnvVar='IA_PROVIDER_ORDER'] - Nombre de la variable de entorno que define el orden.
 * @param {string[]} [forcedOrder] - Orden explícito (ignora env var si se provee).
 */
const getProviderOrder = (orderEnvVar = "IA_PROVIDER_ORDER", forcedOrder = null) => {
  if (Array.isArray(forcedOrder) && forcedOrder.length) {
    return forcedOrder;
  }
  const raw = String(process.env[orderEnvVar] || process.env.IA_PROVIDER_ORDER || "gemini,groq,openrouter")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const known = ["groq", "openrouter", "gemini"];
  if (ollamaHabilitado()) {
    known.push("ollama");
  }
  const order = raw.filter((x) => known.includes(x));
  return order.length
    ? order
    : ollamaHabilitado()
    ? ["gemini", "groq", "openrouter", "ollama"]
    : ["gemini", "groq", "openrouter"];
};

const registrarStoreExito = (providerName) => {
  const store = iaRequestContext?.getStore();
  if (store) {
    let exactProvider = providerName;
    if (providerName === "gemini") {
      const { getGeminiApiKeyStatus } = require("./gemini_keys");
      const status = getGeminiApiKeyStatus();
      exactProvider = status.activeKeyType === "paga" ? "gemini_pago" : "gemini_gratis";
    }
    store.providerUsed = exactProvider;
  }
};

const registrarStoreFallo = (provider, errorMsg) => {
  const store = iaRequestContext?.getStore();
  if (store) {
    store.providerTrace.push({ provider, ok: false, error: errorMsg });
  }
};

const registrarStoreIntentoExito = (provider, forced = false) => {
  const store = iaRequestContext?.getStore();
  if (store) {
    let exactProvider = provider;
    if (provider === "gemini") {
      const { getGeminiApiKeyStatus } = require("./gemini_keys");
      const status = getGeminiApiKeyStatus();
      exactProvider = status.activeKeyType === "paga" ? "gemini_pago" : "gemini_gratis";
    }
    const item = { provider: exactProvider, ok: true };
    if (forced) item.forced = true;
    store.providerTrace.push(item);
  }
};

function optimizarPromptsParaOllama(system, user) {
  let nuevoSystem = system;
  let nuevoUser = user;

  if (system.includes("Sos el asistente de inventario de AgroHabilis")) {
    nuevoSystem = [
      "Sos el asistente de inventario de AgroHabilis por WhatsApp (Argentina).",
      "Respondé SOLO un JSON válido con la estructura:",
      '{"accion": "registro"|"consulta"|"conversacion"|"no_inventario"|"multi_lote",',
      ' "mensaje": "explicación o pregunta si faltan datos importantes o es ambiguo",',
      ' "consulta_filtro_lote": "nombre del lote si consulta stock",',
      ' "registro": {"dominio": "ganado"|"cultivo"|"grano"|"insumo", "efecto": "replace"|"delta",',
      ' "cantidad_cabezas": number|null, "hectareas": number|null, "toneladas_grano": number|null,',
      ' "producto_insumo": string|null, "cantidad_insumo": number|null, "lote_nombre_libre": string|null,',
      ' "categoria_ganado": string|null, "cultivo": string|null, "especie": string|null, "raza": string|null,',
      ' "peso_promedio": number|null, "dias_carencia": number|null, "sanidad_tratamiento": string|null}}',
      "",
      "Reglas:",
      "- accion = no_inventario: saludos, precios, clima o pedidos de crear/agregar nuevos lotes/campos.",
      "- accion = consulta: quiere ver stock.",
      "- accion = registro: quiere guardar/anotar. Completá lote_nombre_libre con el lote mencionado.",
      "- accion = conversacion: datos incompletos o ambiguos."
    ].join("\n");

    nuevoUser = user
      .replace(/Lotes disponibles en catálogo:[\s\S]*?(?=(Campañas disponibles|Modo forzado|Generá la respuesta|$))/g, "Lotes disponibles en catálogo: []\n")
      .replace(/Campañas disponibles en catálogo:[\s\S]*?(?=(Modo forzado|Generá la respuesta|$))/g, "Campañas disponibles en catálogo: []\n");
  }

  if (system.includes("Extracción estructurada para inventario de campo")) {
    nuevoSystem = [
      "Extracción estructurada para inventario de campo (Argentina). Respondé SOLO un JSON válido.",
      "Schema:",
      '{"intencion":"registro_inventario"|null,"dominio":"ganado"|"cultivo"|"grano"|"insumo"|null,"efecto":"replace"|"delta",',
      '"cantidad_cabezas": number|null,"delta_cabezas": number|null,"hectareas": number|null,"delta_hectareas": number|null,',
      '"toneladas_grano": number|null,"delta_toneladas": number|null,',
      '"producto_insumo": string|null,"unidad_insumo": string|null,"cantidad_insumo": number|null,"delta_insumo": number|null,',
      '"categoria_ganado": string|null,"cultivo": string|null,"especie": string|null,',
      '"lote_nombre_libre": string|null,"campana_nombre_libre": string|null,',
      '"peso_promedio": number|null,"raza": string|null,"sanidad_tratamiento": string|null,"dias_carencia": number|null}',
      "",
      "Reglas:",
      "- Extraé los números y entidades tal cual aparecen. Completá lote_nombre_libre con el lote del texto."
    ].join("\n");

    nuevoUser = user
      .replace(/lotes_catalogo_json:[\s\S]*?(?=(campanas_catalogo_json|mensaje_productor|$))/g, "lotes_catalogo_json: []\n")
      .replace(/campanas_catalogo_json:[\s\S]*?(?=(mensaje_productor|$))/g, "campanas_catalogo_json: []\n");
  }

  return { system: nuevoSystem, user: nuevoUser };
}

/**
 * Cadena unificada de proveedores IA con failover automático.
 * @param {object} params
 * @param {string} params.system - Instrucciones del sistema.
 * @param {string} params.user - Mensaje del usuario.
 * @param {string} [params.contextLabel='IA'] - Etiqueta para logs.
 * @param {object} [params.opts] - Opciones avanzadas de generación.
 * @param {number} [params.opts.temperature] - Temperatura.
 * @param {number} [params.opts.maxOutputTokens] - Límite de tokens de salida.
 * @param {string} [params.opts.responseMimeType] - "application/json" para forzar JSON.
 * @param {string} [params.opts.orderEnvVar] - Variable de entorno para el orden.
 * @param {string[]} [params.opts.forcedOrder] - Orden explícito de proveedores.
 * @param {string} [params.opts.geminiModel] - Modelo específico de Gemini a usar.
 */
const runProviderChain = async ({ system, user, contextLabel = "IA", opts = {} }) => {
  const {
    temperature,
    maxOutputTokens,
    responseMimeType,
    orderEnvVar = "IA_PROVIDER_ORDER",
    forcedOrder = null,
    geminiModel = null,
    usePremiumModel = false,
  } = opts;

  const order = getProviderOrder(orderEnvVar, forcedOrder);
  let lastError = null;
  const trace = [];

  // Forzar premium en caliente para rescate o escalamiento conversacional
  const forcePremium = usePremiumModel || process.env.GEMINI_FORCE_PREMIUM_TURN === "true";

  // Opciones compartidas para proveedores OpenAI-compatible
  const sharedOpts = {};
  if (Number.isFinite(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0) {
    sharedOpts.maxTokens = Math.floor(Number(maxOutputTokens));
  }
  if (Number.isFinite(Number(temperature))) {
    sharedOpts.temperature = Number(temperature);
  }
  if (typeof responseMimeType === "string" && responseMimeType.trim()) {
    sharedOpts.responseMimeType = responseMimeType;
  }

  for (const provider of order) {
    try {
      if (provider === "groq" && process.env.GROQ_API_KEY?.trim()) {
        const out = await generarChatGroq({ system, user, ...sharedOpts });
        registrarStoreExito("groq");
        registrarStoreIntentoExito("groq");
        return { ...out, providerUsed: "groq", providerTrace: [...trace, { provider, ok: true }] };
      }
      if (provider === "openrouter" && process.env.OPENROUTER_API_KEY?.trim()) {
        const out = await generarChatOpenRouter({ system, user, ...sharedOpts });
        registrarStoreExito("openrouter");
        registrarStoreIntentoExito("openrouter");
        return { ...out, providerUsed: "openrouter", providerTrace: [...trace, { provider, ok: true }] };
      }
      if (provider === "gemini" && process.env.GEMINI_API_KEY?.trim()) {
        const originalKey = process.env.GEMINI_API_KEY;
        const fallbackKey = process.env.GEMINI_API_KEY_FALLBACK?.trim();
        const premiumModel = process.env.GEMINI_PREMIUM_MODEL?.trim() || getModelName();
        
        let targetKey = originalKey;
        let targetModel = geminiModel;
        let keyChanged = false;
        
        if (forcePremium) {
          if (fallbackKey) {
            targetKey = fallbackKey;
            // Intercambiar clave en process.env temporalmente para que generarTextoConReintentos la lea
            process.env.GEMINI_API_KEY = fallbackKey;
            keyChanged = true;
          }
          targetModel = premiumModel;
        }

        const geminiOpts = {
          systemInstruction: system,
          timeoutMs: getIaTimeoutMs(),
        };
        if (targetModel) geminiOpts.model = targetModel;
        if (Number.isFinite(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0) {
          geminiOpts.maxOutputTokens = Math.floor(Number(maxOutputTokens));
        }
        if (Number.isFinite(Number(temperature))) {
          geminiOpts.temperature = Number(temperature);
        }
        if (typeof responseMimeType === "string" && responseMimeType.trim()) {
          geminiOpts.responseMimeType = responseMimeType;
        }
        
        try {
          const out = await generarTextoConReintentos(user, contextLabel, geminiOpts);
          // Restaurar clave original solo si la modificamos por forcePremium
          if (keyChanged) {
            process.env.GEMINI_API_KEY = originalKey;
          }
          registrarStoreExito("gemini");
          registrarStoreIntentoExito("gemini");
          return { ...out, providerUsed: "gemini", providerTrace: [...trace, { provider, ok: true }] };
        } catch (geminiError) {
          if (keyChanged) {
            process.env.GEMINI_API_KEY = originalKey;
          }
          throw geminiError;
        }
      }
      if (provider === "ollama" && ollamaHabilitado()) {
        const optim = optimizarPromptsParaOllama(system, user);
        const out = await generarChatOllama({ system: optim.system, user: optim.user, ...sharedOpts });
        registrarStoreExito("ollama");
        registrarStoreIntentoExito("ollama");
        return { ...out, providerUsed: "ollama", providerTrace: [...trace, { provider, ok: true }] };
      }
      trace.push({ provider, ok: false, error: "no_configurado" });
      registrarStoreFallo(provider, "no_configurado");
    } catch (error) {
      lastError = error;
      trace.push({ provider, ok: false, error: error.message });
      registrarStoreFallo(provider, error.message);
      console.warn(`[${contextLabel}] ${provider} fallo:`, error.message);
    }
  }

  // Último intento Gemini aunque no esté en orden (mantiene compatibilidad).
  try {
    const out = await generarTextoConReintentos(user, contextLabel, { systemInstruction: system });
    registrarStoreExito("gemini");
    registrarStoreIntentoExito("gemini", true);
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
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 60_000) : 20000;
};

const getIntentClassifierMaxOutputTokens = () => {
  const n = Number(process.env.INTENT_CLASSIFIER_MAX_OUTPUT_TOKENS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 8192) : 4096;
};

/**
 * Clasificación de intención con cadena de proveedores.
 * Modelo: GEMINI_INTENT_MODEL o INTENT_CLASSIFIER_MODEL o GEMINI_MODEL (solo para proveedor Gemini).
 * Si Gemini falla por cuota/429, pasa a Groq → OpenRouter → Ollama.
 */
const generarClasificacionIntencion = async ({ system, user }) => {
  if (!system || !user) {
    throw new Error("Faltan system/user para generarClasificacionIntencion");
  }
  const model = getIntentClassifierModel() || getModelName();
  return runProviderChain({
    system,
    user,
    contextLabel: "IA.intent",
    opts: {
      geminiModel: model,
      maxOutputTokens: getIntentClassifierMaxOutputTokens(),
      temperature: 0,
      responseMimeType: "application/json",
    },
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

/** Respuesta corta (p. ej. JSON de clasificación); cadena de proveedores con techo de tokens. */
const generarTextoClasificadorRapido = async (prompt) => {
  const p = String(prompt || "").trim();
  if (!p) throw new Error("Falta prompt");
  // El prompt legacy viene como "system\n\nuser" concatenado; lo partimos si hay doble newline.
  const idx = p.indexOf("\n\n");
  const system = idx > 0 ? p.slice(0, idx) : "";
  const user = idx > 0 ? p.slice(idx + 2) : p;
  return runProviderChain({
    system,
    user,
    contextLabel: "IA.clasificador",
    opts: {
      maxOutputTokens: Number(process.env.CLASIFICADOR_MAX_OUT || 128),
      temperature: 0,
    },
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
  /** Cadena unificada de proveedores IA con failover automático. */
  runProviderChain,
  /** Reintentos + timeout sobre Gemini SDK; útil para usos directos sin cadena. */
  generarTextoConReintentos,
};
