const { query } = require("../config/database");

const normalizarTexto = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/**
 * Misma selección de “disponible” que el primer resumen / MI RESUMEN:
 * última fecha por cultivo en `precios`, priorizando Rosario > AFA > CAC > resto,
 * y dentro de la fecha el mismo ROW_NUMBER que `primer_resumen.js`.
 */
async function obtenerDisponiblePorCultivosPoliticaResumen(cultivos = []) {
  if (!cultivos.length) return [];
  const norm = cultivos.map((c) => normalizarTexto(c)).filter(Boolean);
  if (!norm.length) return [];
  const result = await query(
    `
      WITH ultima_por_cultivo AS (
        SELECT LOWER(cultivo) AS cultivo_norm, MAX(fecha) AS fecha
        FROM precios
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY LOWER(cultivo)
      ),
      ranked AS (
        SELECT
          p.cultivo,
          p.mercado,
          p.precio,
          p.moneda,
          p.fecha,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(p.cultivo)
            ORDER BY
              CASE
                WHEN LOWER(p.mercado) LIKE '%rosario%' THEN 0
                WHEN LOWER(p.mercado) LIKE '%afa%' THEN 1
                WHEN LOWER(p.mercado) LIKE '%cac%' THEN 2
                ELSE 3
              END,
              CASE WHEN p.moneda = 'USD' THEN 0 ELSE 1 END,
              p.precio DESC
          ) AS rn
        FROM precios p
        JOIN ultima_por_cultivo u
          ON LOWER(p.cultivo) = u.cultivo_norm
         AND p.fecha = u.fecha
        WHERE LOWER(p.cultivo) = ANY($1::text[])
      )
      SELECT cultivo, mercado, precio, moneda, fecha
      FROM ranked
      WHERE rn = 1
      ORDER BY cultivo
    `,
    [norm]
  );
  return result.rows || [];
}

async function obtenerDisponiblePoliticaResumenUnCultivo(cultivo) {
  const rows = await obtenerDisponiblePorCultivosPoliticaResumen([cultivo]);
  return rows[0] || null;
}

module.exports = {
  obtenerDisponiblePorCultivosPoliticaResumen,
  obtenerDisponiblePoliticaResumenUnCultivo,
};
