"use strict";

/**
 * Handler: `cmd_bot_control` — comandos de pausar/activar/estado del bot.
 *
 * Origen: `src/config/whatsapp.js` línea 1316.
 *
 * Estos comandos no tienen "estado conversacional" (pertenecen al
 * usuario en sí, en `whatsapp_bot_control`), pero figuran en paso L
 * porque interactúan con un toggle por chat que el bot consulta en cada
 * turno.
 *
 * Match: si `manejarComandoBot` devuelve respuesta no-vacía, el comando
 * fue PAUSAR/ACTIVAR/ESTADO BOT (o variantes). Si devuelve `null`, no
 * matchea y dejamos pasar.
 *
 * Migrado en: P2#10 paso L.1.
 *
 * Nota: el handler `bot_pausado` (paso K) ya cubre el caso "el bot
 * está pausado y llega un comando de control" — lo procesa ahí para
 * permitir reactivación. Este handler cubre el caso "el bot está
 * activo y el usuario manda PAUSAR/ESTADO/etc.".
 */

const { manejarComandoBot } = require("../consultas");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdBotControl(ctx) {
  const respuesta = await manejarComandoBot(ctx.jid, ctx.consulta || "");
  if (!respuesta) return { manejado: false };
  return {
    manejado: true,
    respuesta,
    route: "CMD_BOT_CONTROL",
  };
}

module.exports = { handlerCmdBotControl };
