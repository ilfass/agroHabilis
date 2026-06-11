"use strict";

/**
 * Cadena de proveedores para respuestas JSON (gates, orquestador de dominio, etc.).
 * Delega a `runProviderChain` de `gemini.js` para ejecutar la cadena unificada,
 * manteniendo aquí solo la lógica de parseo JSON y la compatibilidad con env vars
 * de orden personalizadas (`AGENT_GATE_IA_ORDER`, `AGENT_DOMINIO_IA_ORDER`).
 */

const { runProviderChain } = require("../../gemini");
const { ollamaHabilitado } = require("../../ollama");

const hayProveedorIa = () =>
  Boolean(
    process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GROQ_API_KEY?.trim() ||
      ollamaHabilitado()
  );

const parseJsonObj = (textoBruto = "") => {
  const raw = String(textoBruto || "").trim();
  const sinFence = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = sinFence.indexOf("{");
  const end = sinFence.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? sinFence.slice(start, end + 1) : sinFence;
  return JSON.parse(jsonStr);
};

/**
 * @returns {Promise<{parsed: object, providerUsed: string|null, model: string|null, trace: object[]}>}
 */
const ejecutarJsonConCadenaIA = async ({
  system = "",
  user = "",
  maxTokens = 160,
  orderEnvVar = "AGENT_GATE_IA_ORDER",
  contextLabel = "IA.agent_gate",
} = {}) => {
  try {
    const out = await runProviderChain({
      system: String(system || "").trim(),
      user: String(user || "").trim(),
      contextLabel,
      opts: {
        maxOutputTokens: Math.max(64, Math.floor(Number(maxTokens) || 160)),
        temperature: 0,
        responseMimeType: "application/json",
        orderEnvVar,
      },
    });
    const parsed = parseJsonObj(String(out?.texto || "").trim());
    const trace = out?.providerTrace || [];
    return { parsed, providerUsed: out?.providerUsed || null, model: out?.model || null, trace };
  } catch (e) {
    const err = e;
    err.providerTrace = e.providerTrace || [];
    throw err;
  }
};

module.exports = {
  hayProveedorIa,
  ejecutarJsonConCadenaIA,
};

