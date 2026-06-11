"use strict";

const axios = require("axios");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * @param {object} body - messages, tools?, tool_choice?, temperature?
 * @param {{ xTitle?: string, temperature?: number }} [opts]
 */
const postOpenRouterChat = async (body, opts = {}) => {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  
  if (!openRouterApiKey && !groqApiKey) {
    throw new Error("No hay API keys configuradas para LLM (OpenRouter o Groq)");
  }

  // Sanitize messages to remove fields like 'refusal', 'reasoning', and 'reasoning_details' which are not supported by some LLM backends (like Groq)
  const sanitizedBody = { ...body };
  if (Array.isArray(sanitizedBody.messages)) {
    sanitizedBody.messages = sanitizedBody.messages.map(m => {
      const clean = { ...m };
      if ('refusal' in clean) delete clean.refusal;
      if ('reasoning_details' in clean) delete clean.reasoning_details;
      if ('reasoning' in clean) delete clean.reasoning;
      return clean;
    });
  }

  const temperature = typeof opts.temperature === "number" && Number.isFinite(opts.temperature)
    ? opts.temperature
    : typeof sanitizedBody.temperature === "number"
      ? sanitizedBody.temperature
      : 0.25;

  const tryProvider = async (url, apiKey, model, extraHeaders = {}, overrideBody = null) => {
    const payloadBody = overrideBody || sanitizedBody;
    const { data } = await axios.post(
      url,
      { model, ...payloadBody, temperature },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        timeout: Number(process.env.AGENT_TOOL_LOOP_TIMEOUT_MS || process.env.IA_TIMEOUT_MS || 20000),
      }
    );
    return data;
  };

  let lastError = null;

  // 1. Try OpenRouter
  if (openRouterApiKey) {
    try {
      const openRouterModel = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";
      const referer = process.env.OPENROUTER_HTTP_REFERER?.trim() || "https://agrohabilis.local";
      const xTitle = String(opts.xTitle || "AgroHabilis-openrouter").slice(0, 80);
      return await tryProvider(OPENROUTER_URL, openRouterApiKey, openRouterModel, {
        "HTTP-Referer": referer,
        "X-Title": xTitle,
      });
    } catch (err) {
      lastError = err;
      console.warn(`[OpenRouter Fallback] Falló OpenRouter: ${err.message}. Intentando Groq...`);
    }
  }

  // 2. Try Groq Fallback
  if (groqApiKey) {
    try {
      const groqModel = process.env.GROQ_MODEL?.trim() || "llama-3.1-70b-versatile";
      
      // Para entrar en el límite gratuito de Groq (6000 TPM), reducimos el payload acortando descripciones de herramientas.
      const groqBody = { ...sanitizedBody };
      if (Array.isArray(groqBody.tools)) {
        groqBody.tools = groqBody.tools.map(t => {
          const newTool = { ...t };
          if (newTool.function && newTool.function.description) {
            newTool.function = {
              ...newTool.function,
              description: newTool.function.description.slice(0, 150)
            };
          }
          return newTool;
        });
      }
      
      return await tryProvider("https://api.groq.com/openai/v1/chat/completions", groqApiKey, groqModel, {}, groqBody);
    } catch (err) {
      lastError = err;
      console.warn(`[OpenRouter Fallback] Falló Groq también: ${err.message}`, JSON.stringify(err.response?.data, null, 2));
    }
  }

  throw new Error(`Todos los proveedores fallaron. Último error: ${lastError?.message || 'Desconocido'}`);
};

const parseToolArgs = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

const toOpenAiToolDefinitions = (defs) =>
  defs.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: (t.description || "").slice(0, 800),
      parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} },
    },
  }));

module.exports = {
  postOpenRouterChat,
  parseToolArgs,
  toOpenAiToolDefinitions,
};
