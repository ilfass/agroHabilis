const { query } = require("../config/database");

const obtenerEstado = async (whatsapp) => {
  const wa = String(whatsapp || "").replace(/\D/g, "");
  if (!wa) return null;
  const r = await query(
    `
      SELECT id, whatsapp, flujo, paso, contexto, expira_en, creado_en, actualizado_en
      FROM conversacion_estado
      WHERE whatsapp = $1
        AND expira_en > NOW()
      LIMIT 1
    `,
    [wa]
  );
  return r.rows[0] || null;
};

const guardarEstado = async (
  whatsapp,
  flujo,
  paso,
  contexto = {},
  horasExpiracion = 2
) => {
  const wa = String(whatsapp || "").replace(/\D/g, "");
  if (!wa) throw new Error("Whatsapp inválido para conversacion_estado");
  const ctx = contexto && typeof contexto === "object" ? contexto : {};
  const horas = Number(horasExpiracion);
  const h = Number.isFinite(horas) && horas > 0 ? horas : 2;
  const r = await query(
    `
      INSERT INTO conversacion_estado (whatsapp, flujo, paso, contexto, expira_en)
      VALUES ($1, $2, $3, $4::jsonb, NOW() + ($5::int * interval '1 hour'))
      ON CONFLICT (whatsapp) DO UPDATE SET
        flujo = EXCLUDED.flujo,
        paso = EXCLUDED.paso,
        contexto = EXCLUDED.contexto,
        expira_en = EXCLUDED.expira_en,
        actualizado_en = NOW()
      RETURNING id, whatsapp, flujo, paso, contexto, expira_en
    `,
    [wa, flujo, paso, JSON.stringify(ctx), Math.floor(h)]
  );
  return r.rows[0];
};

const limpiarEstado = async (whatsapp) => {
  const wa = String(whatsapp || "").replace(/\D/g, "");
  if (!wa) return { rowCount: 0 };
  const r = await query(`DELETE FROM conversacion_estado WHERE whatsapp = $1`, [wa]);
  return { rowCount: r.rowCount };
};

/** Solo tras enviar la invitación por WhatsApp (cron / MI RESUMEN / admin), no al armar estado sin envío. */
const marcarInvitacionResumenHoy = async (usuarioId) => {
  if (!usuarioId) return;
  await query(
    `
      UPDATE usuarios
      SET ultima_invitacion_resumen_interactivo = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      WHERE id = $1
    `,
    [usuarioId]
  );
};

const invitacionResumenInteractivoHoy = async (usuarioId) => {
  const r = await query(
    `
      SELECT 1
      FROM usuarios
      WHERE id = $1
        AND ultima_invitacion_resumen_interactivo IS NOT NULL
        AND ultima_invitacion_resumen_interactivo =
            (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
      LIMIT 1
    `,
    [usuarioId]
  );
  return Boolean(r.rows[0]);
};

/**
 * Cuando la invitación se guardó bajo el LID (`usuarios.whatsapp`) pero el usuario
 * responde desde @c.us (número real), `obtenerEstado(waN)` no encuentra fila.
 */
const obtenerEstadoResumenInteractivoPorUsuarioId = async (usuarioId) => {
  const uid = Number.parseInt(String(usuarioId), 10);
  if (!Number.isFinite(uid) || uid <= 0) return null;
  const r = await query(
    `
      SELECT id, whatsapp, flujo, paso, contexto, expira_en, creado_en, actualizado_en
      FROM conversacion_estado
      WHERE flujo = 'resumen_interactivo'
        AND expira_en > NOW()
        AND (contexto->>'usuario_id')::int = $1
      ORDER BY actualizado_en DESC
      LIMIT 1
    `,
    [uid]
  );
  return r.rows[0] || null;
};

module.exports = {
  obtenerEstado,
  guardarEstado,
  limpiarEstado,
  marcarInvitacionResumenHoy,
  invitacionResumenInteractivoHoy,
  obtenerEstadoResumenInteractivoPorUsuarioId,
};
