"use strict";

const { pool } = require("../../../config/database");

const TIPO_CONSULTA_WA = "consulta_whatsapp";

/**
 * @param {{ jid: string, consulta: string, opciones?: object }} p
 */
const encolarConsultaWhatsapp = async ({ jid, consulta, opciones = {} }) => {
  const r = await pool.query(
    `
      INSERT INTO agent_tarea_fila (tipo, payload, estado)
      VALUES ($1, $2::jsonb, 'pending')
      RETURNING id
    `,
    [TIPO_CONSULTA_WA, { jid, consulta, opciones }]
  );
  return r.rows[0]?.id ?? null;
};

/**
 * @returns {Promise<{ id: number, payload: object }|null>}
 */
const reclamarSiguienteConsultaWhatsapp = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `
        SELECT id FROM agent_tarea_fila
        WHERE estado = 'pending' AND tipo = $1
        ORDER BY creado_en ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
      [TIPO_CONSULTA_WA]
    );
    if (!sel.rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    const id = sel.rows[0].id;
    const upd = await client.query(
      `
        UPDATE agent_tarea_fila
        SET estado = 'processing',
            iniciado_en = NOW(),
            intentos = intentos + 1
        WHERE id = $1
        RETURNING id, payload
      `,
      [id]
    );
    await client.query("COMMIT");
    const row = upd.rows[0];
    return row ? { id: row.id, payload: row.payload } : null;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_r) {
      /* */
    }
    throw e;
  } finally {
    client.release();
  }
};

const marcarConsultaOk = async (id) => {
  await pool.query(
    `
      UPDATE agent_tarea_fila
      SET estado = 'done', terminado_en = NOW(), error_text = NULL
      WHERE id = $1
    `,
    [id]
  );
};

const marcarConsultaError = async (id, errorText) => {
  await pool.query(
    `
      UPDATE agent_tarea_fila
      SET estado = 'error', terminado_en = NOW(), error_text = $2
      WHERE id = $1
    `,
    [id, String(errorText || "error").slice(0, 2000)]
  );
};

/**
 * Tareas `processing` demasiado viejas (crash / kill -9) vuelven a `pending`.
 * @returns {Promise<number>} filas actualizadas
 */
const reabrirConsultasProcessingExpiradas = async () => {
  try {
    const mins = Math.min(
      24 * 60,
      Math.max(2, Number.parseInt(String(process.env.AGENT_COLA_STUCK_MINUTES || "15"), 10) || 15)
    );
    const r = await pool.query(
      `
        UPDATE agent_tarea_fila
        SET estado = 'pending', iniciado_en = NULL
        WHERE estado = 'processing'
          AND tipo = $1
          AND iniciado_en IS NOT NULL
          AND iniciado_en < NOW() - ($2::int * INTERVAL '1 minute')
        RETURNING id
      `,
      [TIPO_CONSULTA_WA, mins]
    );
    return r.rowCount || 0;
  } catch (e) {
    console.warn("[agent cola] reabrir processing:", e?.message || e);
    return 0;
  }
};

module.exports = {
  TIPO_CONSULTA_WA,
  encolarConsultaWhatsapp,
  reclamarSiguienteConsultaWhatsapp,
  marcarConsultaOk,
  marcarConsultaError,
  reabrirConsultasProcessingExpiradas,
};
