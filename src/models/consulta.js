const { query } = require("../config/database");

const createHistorialConsultasTableSQL = `
CREATE TABLE IF NOT EXISTS historial_consultas (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  whatsapp VARCHAR(20),
  pregunta TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  tokens_usados INTEGER,
  ia_sin_contexto BOOLEAN,
  ia_provider VARCHAR(40),
  ia_provider_trace JSONB,
  creado_en TIMESTAMP DEFAULT NOW()
);
`;

/**
 * `ia_provider_trace` debe ser JSON array para trazas de IA (p. ej. stats del admin con jsonb_array_elements).
 * Los masivos admin usan un objeto plano { origen, canal } o { backfill_batch }; no lo envolvemos en array.
 */
const normalizarIaProviderTraceParaDb = (iaProvider, trace) => {
  if (trace == null) return null;
  if (String(iaProvider || "").trim() === "broadcast_admin") {
    return trace;
  }
  if (Array.isArray(trace)) return trace;
  if (typeof trace === "object") return [trace];
  return [{ value: String(trace) }];
};

const guardarConsulta = async ({
  usuarioId = null,
  whatsapp,
  pregunta,
  respuesta,
  tokensUsados = null,
  iaSinContexto = null,
  iaProvider = null,
  iaProviderTrace = null,
}) => {
  const sql = `
    INSERT INTO historial_consultas (
      usuario_id, whatsapp, pregunta, respuesta, tokens_usados, ia_sin_contexto, ia_provider, ia_provider_trace
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, creado_en
  `;

  const traceDb = normalizarIaProviderTraceParaDb(iaProvider, iaProviderTrace);
  const values = [
    usuarioId,
    whatsapp,
    pregunta,
    respuesta,
    tokensUsados,
    iaSinContexto,
    iaProvider,
    traceDb != null ? JSON.stringify(traceDb) : null,
  ];
  const result = await query(sql, values);
  return result.rows[0];
};

module.exports = {
  createHistorialConsultasTableSQL,
  guardarConsulta,
};
