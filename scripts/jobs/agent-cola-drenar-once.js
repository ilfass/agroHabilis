#!/usr/bin/env node
/**
 * Procesa una sola fila `consulta_whatsapp` de agent_tarea_fila (sin enviar WhatsApp).
 * Útil en dev/CI para vaciar la cola o ver errores. En producción el drenador corre en el proceso del bot.
 */
require("dotenv").config();
const {
  reclamarSiguienteConsultaWhatsapp,
  marcarConsultaOk,
  marcarConsultaError,
} = require("../../src/services/agent/queue/tarea_fila");
const { procesarConsulta } = require("../../src/services/consultas");

async function main() {
  const job = await reclamarSiguienteConsultaWhatsapp();
  if (!job) {
    console.log("Sin tareas pendientes.");
    process.exit(0);
    return;
  }
  const { id, payload } = job;
  const jid = String(payload?.jid || "").trim();
  const consulta = String(payload?.consulta || "").trim();
  const opciones = payload?.opciones && typeof payload.opciones === "object" ? payload.opciones : {};
  console.log(JSON.stringify({ id, jid, consultaLen: consulta.length }, null, 2));
  if (!jid || !consulta) {
    await marcarConsultaError(id, "payload_invalido");
    process.exit(1);
    return;
  }
  try {
    const out = await procesarConsulta(jid, consulta, opciones);
    console.log("--- respuesta (preview) ---\n", String(out || "").slice(0, 1200));
    await marcarConsultaOk(id);
  } catch (e) {
    console.error(e);
    await marcarConsultaError(id, e?.message || String(e));
    process.exit(1);
  }
}

main().finally(() => {
  const { pool } = require("../../src/config/database");
  void pool.end();
});
