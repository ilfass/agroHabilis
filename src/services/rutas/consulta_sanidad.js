"use strict";

const { query } = require("../../config/database");
const { consultarHistorialSanidad } = require("../inventario/core");

/**
 * rutaConsultaSanidad — Maneja preguntas sobre el historial médico y de eventos de animales.
 */
async function rutaConsultaSanidad({ clasificacion, mensaje, usuario, numeroWhatsapp }) {
  try {
    if (!usuario) return "Lo siento, no pude identificar tu cuenta de productor para buscar tus registros.";

    // Extraemos caravana del mensaje si viene enriquecido o por heurística
    let caravana = null;
    const carMatch = mensaje.match(/caravana:\s*([a-zA-Z0-9_-]+)/i);
    if (carMatch) caravana = carMatch[1];

    const limit = 15;
    const eventos = await consultarHistorialSanidad({ 
      usuarioId: usuario.id, 
      caravana, 
      limit 
    });

    if (!eventos.length) {
      if (caravana) return `No encontré registros sanitarios ni eventos para la caravana *${caravana}*.`;
      return "No tenés registros de sanidad o eventos individuales cargados todavía.";
    }

    let texto = caravana 
      ? `📋 *Historial de la caravana ${caravana}:*\n\n`
      : `📋 *Últimos registros sanitarios y eventos:* \n\n`;

    eventos.forEach(e => {
      const fecha = new Date(e.fecha).toLocaleDateString('es-AR');
      const tipo = String(e.tipo_evento).toUpperCase();
      let detalle = e.valor_texto || "";
      if (e.valor_numerico) detalle += ` ${e.valor_numerico} kg`;
      if (e.observaciones) detalle += ` (${e.observaciones})`;
      
      const animalInfo = caravana ? "" : ` [${e.caravana || 's/c'} - ${e.categoria}]`;
      texto += `• *${fecha}* - ${tipo}: ${detalle}${animalInfo}\n`;
    });

    if (eventos.length === limit) {
      texto += `\n_(Mostrando los últimos ${limit} registros)_`;
    }

    return texto.trim();
  } catch (error) {
    console.error("Error en rutaConsultaSanidad:", error.message);
    return "Hubo un problema al consultar el historial sanitario. Por favor, reintentá en unos minutos.";
  }
}

module.exports = { rutaConsultaSanidad };
