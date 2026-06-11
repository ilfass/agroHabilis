"use strict";

/**
 * Punto de entrada público de consultas (PASO 13 del spec de clasificación/router).
 * Expone la misma superficie que espera `src/config/whatsapp.js`:
 * `procesarConsulta`, `manejarComandoBot`, `obtenerEstadoBot`.
 *
 * Comandos de control del bot → `consultas/bot_control`. El flujo IA/router vive en `agent/pipeline`.
 */

const { parseComandoBot, manejarComandoBot, obtenerEstadoBot } = require("./consultas/bot_control");
const agentPipeline = require("./agent/pipeline/consulta_whatsapp");

const procesarConsulta = async (numeroWhatsapp, pregunta, opciones = {}) => {
  const textoPregunta = String(pregunta || "").trim();
  if (!textoPregunta) return "No recibí la consulta.";

  const comandoControl = parseComandoBot(textoPregunta);
  if (comandoControl) {
    return manejarComandoBot(numeroWhatsapp, textoPregunta);
  }

  return agentPipeline.procesarConsulta(numeroWhatsapp, pregunta, opciones);
};

procesarConsulta.obtenerYCompletarPerfil = agentPipeline.obtenerYCompletarPerfil;

module.exports = {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
  obtenerYCompletarPerfil: agentPipeline.obtenerYCompletarPerfil,
};
