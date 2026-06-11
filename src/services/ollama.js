"use strict";

/**
 * Proveedor IA local vía [Ollama](https://ollama.com/) (sin API key; mismo host que sirve modelos).
 * Útil como ayudante / fallback en `agent/ia/json_chain.js` cuando `OLLAMA_ENABLED=1`.
 */

const axios = require("axios");

const ollamaHabilitado = () =>
  /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_ENABLED || "").trim());

const baseUrl = () =>
  String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");

const getModel = () => process.env.OLLAMA_MODEL?.trim() || "llama3.2";

/**
 * Chat completions estilo OpenAI, API nativa de Ollama `/api/chat`.
 * @returns {Promise<{ texto: string, tokensUsados: null, model: string }>}
 */
const generarChatOllama = async ({ system, user, maxTokens = 512, temperature = 0, responseMimeType = undefined } = {}) => {
  if (!ollamaHabilitado()) {
    throw new Error("OLLAMA_ENABLED no está activo");
  }
  const url = `${baseUrl()}/api/chat`;
  const n = Math.min(8192, Math.max(64, Math.floor(Number(maxTokens) || 512)));
  const temp = Number.isFinite(Number(temperature)) ? Number(temperature) : 0;
  const body = {
    model: getModel(),
    messages: [
      { role: "system", content: String(system || "") },
      { role: "user", content: String(user || "") },
    ],
    stream: false,
    options: {
      temperature: temp,
      num_predict: n,
    },
  };
  if (typeof responseMimeType === "string" && responseMimeType.includes("json")) {
    body.format = "json";
  }
  const iaMs = Number(process.env.IA_TIMEOUT_MS || 15000);
  const ollamaMs = Number(process.env.OLLAMA_TIMEOUT_MS || 0);
  const timeout =
    Number.isFinite(ollamaMs) && ollamaMs > 0
      ? ollamaMs
      : Math.max(Number.isFinite(iaMs) && iaMs > 0 ? iaMs : 15000, 45000);
  const { data } = await axios.post(url, body, {
    timeout,
  });
  if (data?.error) {
    throw new Error(`Ollama: ${String(data.error)}`);
  }
  const texto = String(data?.message?.content || "").trim();
  if (!texto) {
    throw new Error(`Ollama: respuesta vacía (¿modelo instalado? ollama pull ${getModel()})`);
  }
  return { texto, tokensUsados: null, model: String(data?.model || getModel()) };
};

module.exports = {
  ollamaHabilitado,
  generarChatOllama,
  getModel,
  baseUrl,
};
