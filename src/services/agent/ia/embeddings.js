"use strict";

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getGeminiApiKey } = require("../../gemini_keys");

/**
 * Genera el vector de embedding para un texto dado utilizando gemini-embedding-001 (768 dimensiones).
 * @param {string} texto - El texto a vectorizar.
 * @returns {Promise<number[]>} Array de números flotantes de longitud 768.
 */
async function generarEmbedding(texto) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no configurada");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
  
  const result = await model.embedContent({
    content: { parts: [{ text: String(texto || "") }] },
    outputDimensionality: 768
  });

  if (!result?.embedding?.values) {
    throw new Error("No se pudo obtener el vector de embedding de Gemini");
  }

  return result.embedding.values;
}

module.exports = { generarEmbedding };
