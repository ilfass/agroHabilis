"use strict";

const {
  reclamarSiguienteConsultaWhatsapp,
  marcarConsultaOk,
  marcarConsultaError,
  reabrirConsultasProcessingExpiradas,
} = require("./tarea_fila");

let lastReclaimMs = 0;

/**
 * @param {{
 *   procesarConsulta: (jid: string, consulta: string, opciones?: object) => Promise<unknown>,
 *   sendMessage: (jid: string, texto: string) => Promise<unknown>,
 *   formatearFechasTextoArg: (s: string) => string,
 * }} deps
 */
const drenarUnaConsultaWhatsapp = async ({ procesarConsulta, sendMessage, formatearFechasTextoArg }) => {
  const reclaimEvery = Math.min(
    600_000,
    Math.max(30_000, Number.parseInt(String(process.env.AGENT_COLA_RECLAIM_EVERY_MS || "60000"), 10) || 60_000)
  );
  const now = Date.now();
  if (now - lastReclaimMs >= reclaimEvery) {
    lastReclaimMs = now;
    try {
      const n = await reabrirConsultasProcessingExpiradas();
      if (n > 0) {
        console.warn(`[agent cola] Reabiertas ${n} tarea(s) en processing (timeout).`);
      }
    } catch (e) {
      console.warn("[agent cola] reclaim:", e?.message || e);
    }
  }

  let job;
  try {
    job = await reclamarSiguienteConsultaWhatsapp();
  } catch (e) {
    console.warn("[WhatsApp][agent cola] reclamar:", e?.message || e);
    return;
  }
  if (!job) return;
  const { id, payload } = job;
  const jid = String(payload?.jid || "").trim();
  const consulta = String(payload?.consulta || "").trim();
  const opciones = payload?.opciones && typeof payload.opciones === "object" ? payload.opciones : {};
  if (!jid || !consulta) {
    try {
      await marcarConsultaError(id, "payload_invalido");
    } catch (_e) {
      /* */
    }
    return;
  }
  try {
    const respuesta = await procesarConsulta(jid, consulta, opciones);
    const texto =
      typeof respuesta === "string" && respuesta.trim()
        ? formatearFechasTextoArg(respuesta)
        : "No pude armar una respuesta útil con esa consulta. Probá reformularla en una línea (ej: 'precio maíz rosario hoy').";
    await sendMessage(jid, texto);
    await marcarConsultaOk(id);
  } catch (e) {
    try {
      await marcarConsultaError(id, e?.message || String(e));
    } catch (_m) {
      /* */
    }
    try {
      await sendMessage(
        jid,
        "No pude procesar tu consulta en este momento. Probá nuevamente en unos minutos."
      );
    } catch (_s) {
      /* */
    }
  }
};

module.exports = { drenarUnaConsultaWhatsapp };
