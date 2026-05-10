"use strict";

const { query } = require("../../config/database");
const { normalizarWhatsapp } = require("../../models/usuario");

const normalizarTextoComando = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const parseComandoBot = (texto = "") => {
  const cmd = normalizarTextoComando(texto);
  if (cmd === "PAUSAR BOT") return "PAUSAR_BOT";
  if (cmd === "ACTIVAR BOT") return "ACTIVAR_BOT";
  if (cmd === "ESTADO BOT") return "ESTADO_BOT";
  return null;
};

const obtenerEstadoBot = async (numeroWhatsapp) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) return true;
  const result = await query(
    `
      SELECT bot_activo
      FROM whatsapp_bot_control
      WHERE whatsapp = $1
      LIMIT 1
    `,
    [whatsapp]
  );
  if (!result.rows[0]) return true;
  return Boolean(result.rows[0].bot_activo);
};

const setEstadoBot = async (numeroWhatsapp, botActivo) => {
  const whatsapp = normalizarWhatsapp(numeroWhatsapp);
  if (!whatsapp) {
    throw new Error("Numero invalido para controlar estado del bot");
  }
  await query(
    `
      INSERT INTO whatsapp_bot_control (whatsapp, bot_activo)
      VALUES ($1, $2)
      ON CONFLICT (whatsapp)
      DO UPDATE SET
        bot_activo = EXCLUDED.bot_activo,
        actualizado_en = NOW()
    `,
    [whatsapp, botActivo]
  );
};

const manejarComandoBot = async (numeroWhatsapp, texto) => {
  const comando = parseComandoBot(texto);
  if (!comando) return null;

  if (comando === "PAUSAR_BOT") {
    await setEstadoBot(numeroWhatsapp, false);
    return "Listo, desactive el bot para este chat. Para volver a activarlo escribi: ACTIVAR BOT";
  }

  if (comando === "ACTIVAR_BOT") {
    await setEstadoBot(numeroWhatsapp, true);
    return "Perfecto, el bot quedo activado para este chat.";
  }

  const activo = await obtenerEstadoBot(numeroWhatsapp);
  return activo
    ? "Estado del bot: ACTIVO en este chat."
    : "Estado del bot: PAUSADO en este chat.";
};

module.exports = {
  parseComandoBot,
  obtenerEstadoBot,
  setEstadoBot,
  manejarComandoBot,
};
