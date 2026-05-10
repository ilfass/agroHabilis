"use strict";

/**
 * Horas en las que un masivo admin en historial sigue contando como "campaña abierta a feedback".
 * Pasado ese plazo, la fila no entra en consultas de hilo (BROADCAST_FEEDBACK_WINDOW_HOURS, default 24).
 */
const horasFeedbackBroadcastMasivo = () => {
  const raw = parseInt(String(process.env.BROADCAST_FEEDBACK_WINDOW_HOURS || "").trim(), 10);
  const h = Number.isFinite(raw) && raw > 0 ? raw : 24;
  return Math.min(168, Math.max(1, h));
};

/**
 * Incluye todas las filas salvo masivos admin (`ia_provider = broadcast_admin`) con más de N horas.
 * @param {number} paramIdxHoras índice del placeholder `$N` para las horas (entero 1–168).
 */
const sqlMasivoAdminRecienteOtroHistorial = (paramIdxHoras) =>
  `(COALESCE(ia_provider, '') <> 'broadcast_admin' OR creado_en >= NOW() - ($${paramIdxHoras}::int * INTERVAL '1 hour'))`;

module.exports = {
  horasFeedbackBroadcastMasivo,
  sqlMasivoAdminRecienteOtroHistorial,
};
