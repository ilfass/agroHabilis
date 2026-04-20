const { query } = require("../config/database");

const WHATSAPP_SISTEMA = "ahbl:sistema";

const fechaBoletinASql = (fechaMercadoTexto) =>
  fechaMercadoTexto.split("/").reverse().join("-");

const obtenerUsuarioSistemaId = async () => {
  const r = await query(
    `SELECT id FROM usuarios WHERE whatsapp = $1 LIMIT 1`,
    [WHATSAPP_SISTEMA]
  );
  return r.rows[0]?.id ?? null;
};

const obtenerUsuarioPorId = async (usuarioId) => {
  const r = await query(
    `SELECT id, nombre, whatsapp FROM usuarios WHERE id = $1 LIMIT 1`,
    [usuarioId]
  );
  return r.rows[0] ?? null;
};

const upsertResumenPorFechaMercado = async ({
  usuarioId,
  fechaMercadoTexto,
  contenido,
  tokensUsados,
}) => {
  const fechaSql = fechaBoletinASql(fechaMercadoTexto);
  const r = await query(
    `
    INSERT INTO resumenes (usuario_id, fecha, contenido, tokens_usados)
    VALUES ($1, $2::date, $3, $4)
    ON CONFLICT (usuario_id, fecha)
    DO UPDATE SET
      contenido = EXCLUDED.contenido,
      tokens_usados = EXCLUDED.tokens_usados,
      creado_en = NOW(),
      enviado_wp = false,
      enviado_en = NULL
    RETURNING id, usuario_id, fecha, tokens_usados
    `,
    [usuarioId, fechaSql, contenido, tokensUsados]
  );
  return r.rows[0];
};

module.exports = {
  WHATSAPP_SISTEMA,
  obtenerUsuarioSistemaId,
  obtenerUsuarioPorId,
  upsertResumenPorFechaMercado,
  fechaBoletinASql,
};
