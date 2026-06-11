const axios = require("axios");
const FormData = require("form-data");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Readable = require("stream").Readable;

/**
 * Módulo de Transcripción de Voz para AgroHabilis.
 * Intenta usar Groq Whisper (por su velocidad) y cae en Gemini como fallback.
 */

const transcribirAudioGroq = async (audioBuffer, filename = "audio.ogg") => {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY no configurada");

  const form = new FormData();
  form.append("file", audioBuffer, {
    filename,
    contentType: "audio/ogg",
  });
  form.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3");
  form.append("language", "es"); // Forzar español para mejor precisión en agro

  try {
    const { data } = await axios.post(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 20000,
      }
    );
    return data.text;
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error("[Voice] Error en Groq Whisper:", msg);
    throw new Error(`Groq Whisper fallo: ${msg}`);
  }
};

const transcribirAudioGemini = async (audioBuffer, mimeType) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

  const parts = [
    {
      inlineData: {
        data: audioBuffer.toString("base64"),
        mimeType
      }
    },
    { text: "Transcribí este audio de un productor agropecuario. Si hay términos técnicos del campo, asegúrate de escribirlos correctamente. Solo devolvé el texto de la transcripción." }
  ];

  try {
    const result = await model.generateContent(parts);
    const response = await result.response;
    try {
      return response.text().trim();
    } catch (textErr) {
      throw new Error("Error al obtener la transcripción del audio de Gemini: " + textErr.message);
    }
  } catch (error) {
    console.error("[Voice] Error en Gemini Voice:", error.message);
    throw new Error("No pude transcribir el audio.");
  }
};

/**
 * Punto de entrada principal para transcripción.
 * @param {Buffer} audioBuffer
 * @param {string} mimeType
 */
const transcribirAudio = async (audioBuffer, mimeType) => {
  // Intentar Groq primero si hay API Key
  if (process.env.GROQ_API_KEY) {
    try {
      return await transcribirAudioGroq(audioBuffer);
    } catch (err) {
      console.warn("[Voice] Groq falló, intentando Gemini fallback...");
    }
  }

  // Fallback a Gemini
  return await transcribirAudioGemini(audioBuffer, mimeType);
};

module.exports = {
  transcribirAudio
};
