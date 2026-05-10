#!/usr/bin/env node
/**
 * Dump lógico PostgreSQL (formato custom -Fc).
 * Uso en la máquina donde vive DATABASE_URL (local o VPS):
 *   node scripts/backup-dump.js
 *   node scripts/backup-dump.js --out /ruta/archivo.dump
 *   node scripts/backup-dump.js --stdout   # para pipe/SSH (npm run backup:pull)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const PGDUMP = String(process.env.PGDUMP_BIN || "pg_dump").trim() || "pg_dump";

function parseArgs(argv) {
  const stdout = argv.includes("--stdout");
  let out = null;
  const i = argv.indexOf("--out");
  if (i !== -1 && argv[i + 1]) out = argv[i + 1];
  return { stdout, out };
}

function defaultOutPath() {
  const dir = path.resolve(process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), "backups"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(dir, `agrohabilis_${stamp}.dump`);
}

function run() {
  const { stdout, out } = parseArgs(process.argv.slice(2));

  if (!DATABASE_URL) {
    console.error("[backup-dump] Falta DATABASE_URL en el entorno (.env).");
    process.exit(1);
  }

  const args = ["-Fc", "-d", DATABASE_URL, "--no-owner", "--no-acl"];
  if (!stdout && process.env.PGDUMP_VERBOSE === "1") args.push("-v");

  const child = spawn(PGDUMP, args, {
    stdio: stdout ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  });

  child.on("error", (err) => {
    console.error("[backup-dump] No se pudo ejecutar pg_dump:", err.message);
    console.error("[backup-dump] ¿Instalado postgresql-client? PGDUMP_BIN=", PGDUMP);
    process.exit(1);
  });

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => {
      if (stdout) process.stderr.write(c);
    });
  }

  if (stdout) {
    child.stdout.pipe(process.stdout);
    child.on("close", (code) => {
      if (code !== 0) process.exit(code == null ? 1 : code);
    });
    return;
  }

  const target = out ? path.resolve(out) : defaultOutPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const ws = fs.createWriteStream(target);
  child.stdout.pipe(ws);

  child.on("close", (code) => {
    if (code !== 0) {
      try {
        fs.unlinkSync(target);
      } catch (_) {
        /* ignore */
      }
      console.error("[backup-dump] pg_dump falló con código", code);
      process.exit(code == null ? 1 : code);
    }
    const stat = fs.statSync(target);
    console.log("[backup-dump] OK", target, `(${Math.round(stat.size / 1024)} KiB)`);
  });
}

run();
