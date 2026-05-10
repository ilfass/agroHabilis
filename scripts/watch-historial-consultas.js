#!/usr/bin/env node
/**
 * Vigila `historial_consultas` para un WhatsApp (casi en vivo) y muestra nuevas filas.
 * Sirve para analizar conversación con el bot y pegar tramos en Cursor.
 *
 * Uso:
 *   node scripts/watch-historial-consultas.js --whatsapp 5492494468949
 *   node scripts/watch-historial-consultas.js --whatsapp 5492494468949 --interval 4000 --bootstrap 12
 *
 * Requiere DATABASE_URL en .env (misma que el API). Ctrl+C cierra el pool y sale.
 */
require("dotenv").config();

const { query, pool } = require("../src/config/database");

const normDigits = (w) => String(w || "").replace(/\D/g, "");

function parseArgs() {
  const a = process.argv.slice(2);
  let whatsapp = null;
  let intervalMs = 5000;
  let bootstrap = 8;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === "--whatsapp" && a[i + 1]) {
      whatsapp = normDigits(a[i + 1]);
      i += 1;
      continue;
    }
    if (a[i] === "--interval" && a[i + 1]) {
      intervalMs = Math.max(1500, Number(a[i + 1]) || 5000);
      i += 1;
      continue;
    }
    if (a[i] === "--bootstrap" && a[i + 1]) {
      bootstrap = Math.min(100, Math.max(0, Number(a[i + 1]) || 0));
      i += 1;
      continue;
    }
  }
  return { whatsapp, intervalMs, bootstrap };
}

const sqlLike = (digits) => `%${digits}%`;

const sqlWhereWa = `
  REPLACE(REPLACE(REPLACE(COALESCE(whatsapp, ''), ' ', ''), '+', ''), '-', '') LIKE $1
`;

function trunc(s, n) {
  const t = String(s ?? "").replace(/\r\n/g, "\n");
  if (t.length <= n) return t;
  return `${t.slice(0, n)}…`;
}

function printRow(row) {
  const line = "=".repeat(72);
  console.log(`\n${line}`);
  console.log(`id=${row.id}  creado_en=${row.creado_en}  wa=${row.whatsapp}`);
  console.log(`tokens=${row.tokens_usados ?? "—"}  ia_sin_contexto=${row.ia_sin_contexto ?? "—"}`);
  console.log(`--- PREGUNTA ---\n${trunc(row.pregunta, 4000)}`);
  console.log(`--- RESPUESTA ---\n${trunc(row.respuesta, 8000)}`);
  console.log(line);
}

async function main() {
  const { whatsapp, intervalMs, bootstrap } = parseArgs();
  if (!whatsapp || whatsapp.length < 8) {
    console.error("Uso: node scripts/watch-historial-consultas.js --whatsapp 5492494468949 [--interval 5000] [--bootstrap 8]");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Falta DATABASE_URL en el entorno o .env");
    process.exit(1);
  }

  const like = sqlLike(whatsapp);
  let lastId = 0;

  if (bootstrap > 0) {
    const r = await query(
      `
        SELECT id, whatsapp, pregunta, respuesta, creado_en, tokens_usados, ia_sin_contexto
        FROM historial_consultas
        WHERE ${sqlWhereWa}
        ORDER BY id DESC
        LIMIT $2
      `,
      [like, bootstrap]
    );
    const rows = (r.rows || []).slice().reverse();
    console.log(`[watch] Bootstrap: últimas ${rows.length} filas para LIKE ${like}`);
    for (const row of rows) {
      printRow(row);
      if (Number(row.id) > lastId) lastId = Number(row.id);
    }
  } else {
    const r = await query(
      `SELECT COALESCE(MAX(id), 0)::int AS m FROM historial_consultas WHERE ${sqlWhereWa}`,
      [like]
    );
    lastId = Number(r.rows[0]?.m) || 0;
    console.log(`[watch] Sin bootstrap: solo filas nuevas con id > ${lastId} (LIKE ${like})`);
  }

  console.log(`\n[watch] Polling cada ${intervalMs}ms. Ctrl+C para salir.\n`);

  const tick = async () => {
    try {
      const r = await query(
        `
          SELECT id, whatsapp, pregunta, respuesta, creado_en, tokens_usados, ia_sin_contexto
          FROM historial_consultas
          WHERE ${sqlWhereWa} AND id > $2
          ORDER BY id ASC
        `,
        [like, lastId]
      );
      for (const row of r.rows || []) {
        printRow(row);
        lastId = Math.max(lastId, Number(row.id) || 0);
      }
    } catch (e) {
      console.error("[watch] error query:", e.message);
    }
  };

  await tick();
  const timer = setInterval(tick, intervalMs);

  const shutdown = async () => {
    clearInterval(timer);
    try {
      await pool.end();
    } catch (_e) {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
