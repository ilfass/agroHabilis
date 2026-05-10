#!/usr/bin/env node
/**
 * Borra dumps viejos en BACKUP_LOCAL_DIR (por antigüedad del archivo).
 * Patrón: agrohabilis_*.dump (incluye pull vps y dumps locales).
 * BACKUP_RETENTION_DAYS=0 desactiva. Por defecto 14.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const DUMP_RE = /^agrohabilis_.*\.dump$/i;

function retentionDays() {
  const raw = process.env.BACKUP_RETENTION_DAYS;
  if (raw === undefined || raw === null || String(raw).trim() === "") return 14;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 3650);
}

function rotateBackups() {
  const days = retentionDays();
  const dir = path.resolve(process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), "backups"));

  if (days <= 0) {
    console.error("[backup-rotate] Desactivado (BACKUP_RETENTION_DAYS=0 o inválido).");
    return { removed: 0, skipped: true };
  }

  if (!fs.existsSync(dir)) {
    console.error("[backup-rotate] Carpeta inexistente:", dir);
    return { removed: 0, skipped: true };
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  let bytes = 0;

  for (const name of fs.readdirSync(dir)) {
    if (!DUMP_RE.test(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.mtimeMs >= cutoff) continue;
    try {
      bytes += st.size;
      fs.unlinkSync(full);
      removed += 1;
    } catch (e) {
      console.error("[backup-rotate] No se pudo borrar", full, e.message);
    }
  }

  if (removed > 0) {
    console.error(
      "[backup-rotate] Eliminados",
      removed,
      "archivo(s) más viejos que",
      days,
      "días (~" + Math.round(bytes / 1024 / 1024) + " MiB liberados)."
    );
  }
  return { removed, skipped: false };
}

if (require.main === module) {
  rotateBackups();
}

module.exports = { rotateBackups, retentionDays };
