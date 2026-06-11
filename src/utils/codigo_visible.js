"use strict";

/**
 * Generador de códigos visibles para entidades de campo.
 *
 * Formato: PREFIJO-NNN  (ej: LOT-001, FDL-014, CAM-003, FIR-002, COR-007)
 * El número es secuencial por usuario, no global.
 */

const PREFIJOS = {
  firmas:   "FIR",
  campos:   "CAM",
  lotes:    "LOT",
  feedlots: "FDL",
  corrales: "COR",
};

/**
 * Genera el próximo código para una tabla y usuario dados.
 *
 * @param {Function} queryFn  - función query(sql, params)
 * @param {string}   tabla    - nombre de tabla (firmas, campos, lotes, feedlots, corrales)
 * @param {string}   prefijo  - prefijo de código (FIR, CAM, LOT, FDL, COR)
 * @param {number}   usuarioId
 * @returns {Promise<string>} - ej: "LOT-004"
 */
async function generarCodigo(queryFn, tabla, prefijo, usuarioId) {
  const tablasSafe = ["firmas", "campos", "lotes", "feedlots", "corrales", "ubicaciones"];
  if (!tablasSafe.includes(tabla)) {
    throw new Error(`tabla no soportada para codigo_visible: ${tabla}`);
  }

  const { rows } = await queryFn(
    `SELECT codigo FROM ${tabla}
     WHERE usuario_id = $1 AND codigo LIKE $2
     ORDER BY codigo DESC LIMIT 1`,
    [usuarioId, `${prefijo}-%`]
  );

  const ultimo = rows[0]?.codigo;
  const siguiente = ultimo ? parseInt(ultimo.split("-")[1], 10) + 1 : 1;
  return `${prefijo}-${String(siguiente).padStart(3, "0")}`;
}

module.exports = {
  PREFIJOS,
  generarCodigo,
};
