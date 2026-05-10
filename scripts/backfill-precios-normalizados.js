require("dotenv").config();
const { query, pool } = require("../src/config/database");

const run = async () => {
  try {
    await query(
      `
        INSERT INTO precios_normalizados (
          producto, mercado, tipo_registro, posicion, moneda, precio, tipo_cambio_implicito,
          condicion, plaza, fuente, fecha_mercado, timestamp_origen, metadata
        )
        SELECT
          LOWER(p.cultivo) AS producto,
          CASE
            WHEN LOWER(p.mercado) ~ 'matba|rofex' THEN 'MATBA_ROFEX'
            WHEN LOWER(p.mercado) LIKE '%cac%' THEN 'CAC'
            WHEN LOWER(p.mercado) LIKE '%magyp%' THEN 'MAGYP'
            WHEN LOWER(p.mercado) LIKE '%bcr%' THEN 'BCR'
            WHEN LOWER(p.mercado) LIKE '%afa%' THEN 'AFA'
            ELSE UPPER(LEFT(COALESCE(p.mercado, 'OTRO'), 40))
          END AS mercado,
          CASE
            WHEN LOWER(p.mercado) ~ 'matba|rofex|futuro|indice_ref' THEN 'future'
            ELSE 'spot'
          END AS tipo_registro,
          NULL::varchar AS posicion,
          p.moneda,
          p.precio,
          NULL::varchar AS tipo_cambio_implicito,
          CASE
            WHEN LOWER(p.mercado) LIKE '%fob%' THEN 'FOB'
            WHEN LOWER(p.mercado) LIKE '%fas%' THEN 'FAS'
            WHEN LOWER(p.mercado) ~ 'camara|c[aá]mara' THEN 'Camara'
            ELSE NULL
          END AS condicion,
          CASE
            WHEN LOWER(p.mercado) ~ 'ros|rosario' THEN 'rosario'
            WHEN LOWER(p.mercado) ~ 'bahia|bahía' THEN 'bahia_blanca'
            ELSE NULL
          END AS plaza,
          p.mercado AS fuente,
          p.fecha AS fecha_mercado,
          COALESCE(p.creado_en, NOW()) AS timestamp_origen,
          jsonb_build_object('backfill', true, 'origen', 'precios') AS metadata
        FROM precios p
        ON CONFLICT (
          producto, mercado, tipo_registro, posicion, moneda,
          tipo_cambio_implicito, condicion, plaza, fecha_mercado
        )
        DO UPDATE SET
          precio = EXCLUDED.precio,
          fuente = EXCLUDED.fuente,
          timestamp_origen = EXCLUDED.timestamp_origen,
          metadata = EXCLUDED.metadata
      `
    );

    await query(
      `
        INSERT INTO precios_normalizados (
          producto, mercado, tipo_registro, posicion, moneda, precio, tipo_cambio_implicito,
          condicion, plaza, fuente, fecha_mercado, timestamp_origen, metadata
        )
        SELECT
          LOWER(f.cultivo) AS producto,
          'MATBA_ROFEX' AS mercado,
          'future' AS tipo_registro,
          f.posicion,
          'USD' AS moneda,
          f.precio_usd AS precio,
          NULL::varchar AS tipo_cambio_implicito,
          'Ajuste' AS condicion,
          NULL::varchar AS plaza,
          'futuros_posiciones' AS fuente,
          f.fecha AS fecha_mercado,
          NOW() AS timestamp_origen,
          jsonb_build_object(
            'backfill', true,
            'origen', 'futuros_posiciones',
            'variacion', f.variacion,
            'volumen', f.volumen
          ) AS metadata
        FROM futuros_posiciones f
        WHERE f.precio_usd IS NOT NULL
        ON CONFLICT (
          producto, mercado, tipo_registro, posicion, moneda,
          tipo_cambio_implicito, condicion, plaza, fecha_mercado
        )
        DO UPDATE SET
          precio = EXCLUDED.precio,
          timestamp_origen = EXCLUDED.timestamp_origen,
          metadata = EXCLUDED.metadata
      `
    );

    const c = await query("SELECT COUNT(*)::int AS total FROM precios_normalizados");
    console.log(`[Backfill] precios_normalizados total=${c.rows[0]?.total || 0}`);
  } catch (error) {
    console.error("[Backfill] Error:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

run();
