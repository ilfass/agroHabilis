"use strict";

const { runProviderChain } = require("../../gemini");

/**
 * Humaniza una respuesta cruda del backend para el productor en WhatsApp.
 * 
 * @param {object} params
 * @param {string} params.mensajeOriginal - El mensaje que envió el productor.
 * @param {string} params.datosCrudos - La respuesta técnica/cruda devuelta por la base de datos o API.
 * @param {object|null} params.usuario - El perfil del usuario de AgroHabilis.
 * @returns {Promise<string>} La respuesta conversacional formateada para WhatsApp.
 */
async function humanizarRespuesta({ mensajeOriginal, datosCrudos, usuario }) {
  const nombre = usuario?.nombre ? String(usuario.nombre).split(" ")[0].trim() : "che";
  
  const system = [
    "Sos AgroHabilis, asistente agropecuario virtual por WhatsApp para productores de Argentina.",
    "Tu única tarea es tomar una consulta del usuario y los datos crudos obtenidos del backend, y redactar una respuesta conversacional, amigable y muy útil.",
    "",
    "Reglas de Respuesta y Formato:",
    "1. Respondé siempre en español rioplatense (voseo argentino, ej: 'cómo andás', 'acá tenés', 'mirá').",
    "2. Sé sumamente claro, práctico y directo. Evitá rodeos comerciales o introducciones largas.",
    "3. No inventes ningún dato numérico, precio ni condición climática que no aparezca en los 'datos crudos'.",
    "4. Formato WhatsApp obligatorio:",
    "   - Usá *negrita* para títulos y cifras clave (ej. *Rosario*, *$400.000*).",
    "   - Usá _cursiva_ para destacar algún matiz corto.",
    "   - Usá emojis al inicio de bloques relevantes (🌾, 🌤️, 💱, 💸, 📒) si ayudan a leer.",
    "   - Usá la línea ━━━━━━━━━━━━━━━━━━━━ si el mensaje tiene varias secciones diferenciadas.",
    "   - NUNCA uses encabezados markdown como '##' o '**'.",
    `5. Como el productor se llama ${nombre}, podés saludarlo al comienzo de la conversación si es adecuado.`
  ].join("\n");

  const user = [
    `Mensaje del Productor: "${mensajeOriginal}"`,
    "",
    `Datos Crudos del Backend:`,
    `"""`,
    datosCrudos,
    `"""`
  ].join("\n");

  try {
    const out = await runProviderChain({
      system,
      user,
      contextLabel: "IA.humanizer",
      opts: {
        temperature: 0.2, // Tono conversacional natural pero preciso
        maxOutputTokens: 2048
      }
    });
    return String(out?.texto || datosCrudos).trim();
  } catch (err) {
    console.warn("[humanizer] Error en generación de IA, retornando datos crudos:", err.message);
    return datosCrudos;
  }
}

module.exports = {
  humanizarRespuesta
};
