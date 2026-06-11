#!/usr/bin/env node
/**
 * Llama al API admin en el mismo host (proceso con WhatsApp) para enviar la invitación
 * al resumen interactivo a una lista de usuario_id.
 *
 * Uso (en la VPS, con la app corriendo):
 *   node scripts/enviar-resumen-por-ids.js 252 258 260
 *
 * Opcional: BASE_URL=http://127.0.0.1:3000 (default PORT del .env o 3000)
 */
require("dotenv").config();
const http = require("http");
const https = require("https");

const ids = process.argv.slice(2).map((a) => Number.parseInt(a, 10)).filter((n) => n > 0);
if (!ids.length) {
  console.error("Uso: node scripts/enviar-resumen-por-ids.js <id1> [id2 ...]");
  process.exit(1);
}

const adminKey = process.env.ADMIN_KEY?.trim();
if (!adminKey) {
  console.error("Falta ADMIN_KEY en .env");
  process.exit(1);
}

const port = Number.parseInt(String(process.env.PORT || "3000"), 10) || 3000;
const base = String(process.env.BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const u = new URL(`${base}/api/admin/enviar-resumen`);
const body = JSON.stringify({ usuario_ids: ids });
const isHttps = u.protocol === "https:";
const lib = isHttps ? https : http;

const opts = {
  hostname: u.hostname,
  port: u.port || (isHttps ? 443 : 80),
  path: u.pathname,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "x-admin-key": adminKey,
  },
};

const req = lib.request(opts, (res) => {
  let raw = "";
  res.on("data", (c) => {
    raw += c;
  });
  res.on("end", () => {
    try {
      const j = JSON.parse(raw);
      console.log(JSON.stringify(j, null, 2));
      if (!j.ok) process.exitCode = 1;
    } catch (_e) {
      console.log(raw);
      process.exitCode = res.statusCode >= 400 ? 1 : 0;
    }
  });
});
req.on("error", (e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
req.write(body);
req.end();
