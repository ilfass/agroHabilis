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

const resolverExactIaProvider = (iaProvider, trace) => {
  const knownExact = [
    "gemini_gratis",
    "gemini_pago",
    "gemini_vision",
    "groq",
    "openrouter",
    "ollama",
    "heuristica"
  ];
  if (knownExact.includes(iaProvider)) {
    return iaProvider;
  }

  if (iaProvider === "broadcast_admin") {
    return "broadcast_admin";
  }

  // Buscar en las trazas algún proveedor exitoso
  const str = trace ? JSON.stringify(trace) : "";
  if (str.includes('"provider":"openrouter"') || str.includes('"providerUsed":"openrouter"')) {
    return "openrouter";
  }
  if (str.includes('"provider":"groq"') || str.includes('"providerUsed":"groq"')) {
    return "groq";
  }
  if (str.includes('"provider":"ollama"') || str.includes('"providerUsed":"ollama"')) {
    return "ollama";
  }
  if (str.includes('"provider":"gemini"') || str.includes('"providerUsed":"gemini"')) {
    const { getGeminiApiKeyStatus } = require("../services/gemini_keys");
    const status = getGeminiApiKeyStatus();
    return status.activeKeyType === "paga" ? "gemini_pago" : "gemini_gratis";
  }

  if (
    iaProvider === "registrar_inventario_pendiente" ||
    iaProvider === "dialogo_hilo" ||
    !iaProvider
  ) {
    if (!str || str === "[]" || str === "{}") {
      return "heuristica";
    }
  }

  const { getGeminiApiKeyStatus } = require("../services/gemini_keys");
  const status = getGeminiApiKeyStatus();
  return status.activeKeyType === "paga" ? "gemini_pago" : "gemini_gratis";
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
  const exactProvider = resolverExactIaProvider(iaProvider, traceDb);

  const values = [
    usuarioId,
    whatsapp,
    pregunta,
    respuesta,
    tokensUsados,
    iaSinContexto,
    exactProvider,
    traceDb != null ? JSON.stringify(traceDb) : null,
  ];
  const result = await query(sql, values);
  return result.rows[0];
};

module.exports = {
  createHistorialConsultasTableSQL,
  guardarConsulta,
};
