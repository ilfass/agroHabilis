const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

/**
 * Módulo de Visión para AgroHabilis.
 * Utiliza Gemini Multimodal para analizar imágenes agropecuarias.
 */

const getModelName = () => process.env.GEMINI_VISION_MODEL || "gemini-1.5-flash";

const SYSTEM_PROMPT_VISION = `
Sos un experto agrónomo y veterinario con capacidad de visión artificial. Tu tarea es analizar imágenes enviadas por productores agropecuarios argentinos y extraer información valiosa.

Capacidades requeridas:
1. Ganadería:
   - Contar animales (estimado si hay muchos).
   - Identificar categorías (Vaca, Toro, Novillo, Ternero, Vaquillona).
   - Condición corporal (escala 1-5 o 1-9 según parezca más claro, o cualitativo: flaco, bueno, gordo).
   - Razas (Angus, Hereford, Braford, Brangus, Holando, etc.).

2. Agricultura:
   - Estado fenológico (emergencia, macollaje, floración, llenado, madurez).
   - Cobertura del suelo (%).
   - Malezas (identificar si es posible: yuyo colorado, rama negra, etc.).
   - Plagas y enfermedades: detectar síntomas visuales (roya, mancha ojo de rana, trips, etc.).
   - Daños: granizo, helada, sequía.

3. Infraestructura y Maquinaria:
   - Identificar máquinas (tractor, cosechadora, pulverizadora, sembradora).
   - Estado de alambrados, tranqueras, aguadas (tanques australianos, molinos).

4. Documentos (OCR Técnico):
   - Leer remitos, tickets de balanza, facturas.
   - Extraer: producto, cantidad (kg/tn), fecha, origen/destino, humedad, impurezas.
   - Análisis de suelo: pH, Materia Orgánica, Fósforo, Nitrógeno.

Reglas de respuesta:
- Respondé en español rioplatense, de forma directa y profesional.
- Si no estás seguro de algo, aclará que es una estimación visual.
- Si la imagen es borrosa o no se ve el objeto, pedí otra foto.
- Formato: Usá negritas para datos clave. No uses markdown complejo, solo lo que WhatsApp soporta (*negrita*, _cursiva_).
- Sé breve pero preciso.
`;

/**
 * @param {Buffer} mediaBuffer - Buffer del archivo (imagen o PDF).
 * @param {string} mimeType - Tipo MIME (image/jpeg, image/png, application/pdf).
 * @param {string} userPrompt - Texto opcional enviado por el usuario.
 */
const analizarMediaAgro = async (mediaBuffer, mimeType, userPrompt = "") => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ 
    model: getModelName(),
    systemInstruction: SYSTEM_PROMPT_VISION
  });

  const parts = [
    {
      inlineData: {
        data: mediaBuffer.toString("base64"),
        mimeType
      }
    },
    { text: userPrompt || "Analizá este archivo y extraé la información técnica relevante para el productor." }
  ];

  try {
    const result = await model.generateContent(parts);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("[Vision] Error analizando media:", error.message);
    throw new Error("No pude procesar el archivo en este momento.");
  }
};

module.exports = {
  analizarMediaAgro
};
