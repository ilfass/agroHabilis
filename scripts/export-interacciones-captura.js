#!/usr/bin/env node
/**
 * Exporta hilos guardados en whatsapp_interaccion_log a exports/interacciones/
 * (Markdown por número, orden cronológico).
 *
 * Uso:
 *   node scripts/export-interacciones-captura.js
 *   node scripts/export-interacciones-captura.js --dias 14
 *   node scripts/export-interacciones-captura.js --whatsapp 5491112223333
 *
 * Si no pasás --whatsapp, usa CAPTURA_HILO_WHATSAPP del .env; si tampoco hay,
 * exporta los 12 números con más filas en el rango de días.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { query, pool } = require("../src/config/database");
const capturaMod = require("../src/services/interacciones_captura");

const OUT_DIR = path.resolve(__dirname, "../exports/interacciones");

const argDias = (() => {
  const i = process.argv.indexOf("--dias");
  if (i >= 0 && process.argv[i + 1]) return Math.min(365, Math.max(1, Number(process.argv[i + 1]) || 14));
  return 14;
})();

const argWhatsapp = (() => {
  const i = process.argv.indexOf("--whatsapp");
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]).replace(/\D/g, "");
  return "";
})();

const esc = (s) =>
  String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/</g, "\\<");

async function numerosAExportar() {
  if (argWhatsapp) return [argWhatsapp];
  const fromEnv = capturaMod.parseListaCaptura();
  if (fromEnv.length) return fromEnv;
  const r = await query(
    `
      SELECT whatsapp_norm, COUNT(*)::int AS n
      FROM whatsapp_interaccion_log
      WHERE creado_en >= NOW() - ($1::integer * INTERVAL '1 day')
      GROUP BY whatsapp_norm
      ORDER BY n DESC, whatsapp_norm
      LIMIT 12
    `,
    [argDias]
  );
  return (r.rows || []).map((x) => x.whatsapp_norm).filter(Boolean);
}

async function filasParaNumero(whatsappNorm) {
  const r = await query(
    `
      SELECT direccion, cuerpo, ruta, creado_en
      FROM whatsapp_interaccion_log
      WHERE whatsapp_norm = $1
        AND creado_en >= NOW() - ($2::integer * INTERVAL '1 day')
      ORDER BY creado_en ASC, id ASC
    `,
    [whatsappNorm, argDias]
  );
  return r.rows || [];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await capturaMod.ensureTabla();

  const numeros = await numerosAExportar();
  if (!numeros.length) {
    console.log("Nada que exportar: configurá CAPTURA_HILO_WHATSAPP o pasá --whatsapp.");
    await pool.end();
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  let total = 0;

  for (const w of numeros) {
    const rows = await filasParaNumero(w);
    if (!rows.length) continue;
    const lines = [
      `# Hilo WhatsApp ${w}`,
      "",
      `_Exportado ${new Date().toISOString()} · últimos ${argDias} días_`,
      "",
    ];
    for (const row of rows) {
      const t = row.creado_en instanceof Date ? row.creado_en.toISOString() : String(row.creado_en);
      const tag = row.direccion === "in" ? "Usuario" : "Bot";
      const ruta = row.ruta ? ` _(${esc(row.ruta)})_` : "";
      lines.push(`## ${tag} · ${t}${ruta}`, "", "```", esc(row.cuerpo), "```", "");
    }
    const file = path.join(OUT_DIR, `hilo_${w}_${stamp}.md`);
    fs.writeFileSync(file, lines.join("\n"), "utf8");
    total += rows.length;
    console.log(`OK ${file} (${rows.length} mensajes)`);
  }

  console.log(`Listo: ${numeros.length} archivo(s), ${total} líneas de log en total.`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
