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
    filename: filename || "audio.ogg",
    contentType: "audio/ogg",
  });
  form.append("model", process.env.GROQ_WHISPER_MODEL?.trim() || "whisper-large-v3-turbo");
  form.append("language", "es");

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
    return (data.text || "").trim();
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    console.error("[Voice] Error en Groq Whisper:", msg);
    throw new Error(`Groq Whisper fallo: ${msg}`);
  }
};

const transcribirAudioGemini = async (audioBuffer, mimeType = "audio/ogg") => {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const cleanMime = String(mimeType || "audio/ogg").split(";")[0].trim().toLowerCase() || "audio/ogg";
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
  const model = genAI.getGenerativeModel({ model: modelName });

  const parts = [
    {
      inlineData: {
        data: audioBuffer.toString("base64"),
        mimeType: cleanMime
      }
    },
    { text: "Transcribí este audio de un productor agropecuario. Si hay términos técnicos del campo, asegúrate de escribirlos correctamente. Solo devolvé el texto de la transcripción en español." }
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
const transcribirAudio = async (audioBuffer, mimeType = "audio/ogg") => {
  if (process.env.GROQ_API_KEY?.trim()) {
    try {
      return await transcribirAudioGroq(audioBuffer);
    } catch (err) {
      console.warn("[Voice] Groq falló, intentando Gemini fallback...");
    }
  }

  return await transcribirAudioGemini(audioBuffer, mimeType);
};

module.exports = {
  transcribirAudio
};
