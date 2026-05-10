#!/usr/bin/env node
/**
 * Falla si `precios` no tiene columnas e índice que exige el recolector (UPSERT ON CONFLICT).
 * Invocar después de setup-db y db:migrate, antes de reiniciar PM2 en despliegue.
 */
require("dotenv").config();
const { query, pool } = require("../../src/config/database");

async function main() {
  const cols = await query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'precios'
        AND column_name = ANY($1::text[])
    `,
    [["fuente", "actualizado_en"]]
  );
  const have = new Set((cols.rows || []).map((r) => r.column_name));
  for (const need of ["fuente", "actualizado_en"]) {
    if (!have.has(need)) {
      throw new Error(
        `Falta columna public.precios.${need}. Corré antes: node scripts/db/setup-db.js y npm run db:migrate`
      );
    }
  }

  const idx = await query(
    `
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'ux_precios_cultivo_mercado_fecha_fuente'
      LIMIT 1
    `
  );
  if (!idx.rows?.length) {
    throw new Error(
      "Falta índice único ux_precios_cultivo_mercado_fecha_fuente (requerido para ON CONFLICT (cultivo, mercado, fecha, fuente) del recolector)."
    );
  }

  console.log("OK esquema precios: columnas fuente, actualizado_en e índice UPSERT.");
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_e) {
      /* */
    }
  });
