#!/usr/bin/env node
/**
 * Desde tu PC: ejecuta pg_dump en el VPS vía SSH y guarda el .dump localmente.
 * Requiere en .env (solo en tu máquina): BACKUP_SSH_TARGET, BACKUP_REMOTE_APP_DIR
 * Opcional: BACKUP_LOCAL_DIR, BACKUP_SSH_EXTRA (args extra para ssh, ej. -i ~/.ssh/id_ed25519)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const sshTarget = String(process.env.BACKUP_SSH_TARGET || "").trim();
const remoteDir = String(process.env.BACKUP_REMOTE_APP_DIR || "").trim();
const localDir = path.resolve(process.env.BACKUP_LOCAL_DIR || path.join(process.cwd(), "backups"));
const sshExtra = String(process.env.BACKUP_SSH_EXTRA || "").trim();

function parseSshArgs(extra) {
  if (!extra) return [];
  const m = extra.match(/(?:[^\s"]+|"[^"]*")+/g);
  return (m || []).map((s) => s.replace(/^"|"$/g, ""));
}

function main() {
  if (!sshTarget || !remoteDir) {
    console.error(
      "[backup-pull] Definí en tu .env local: BACKUP_SSH_TARGET (ej. usuario@ip) y BACKUP_REMOTE_APP_DIR (ruta absoluta del repo en el VPS)."
    );
    process.exit(1);
  }

  fs.mkdirSync(localDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outFile = path.join(localDir, `agrohabilis_vps_${stamp}.dump`);

  const remoteCmd = `cd ${shellQuote(remoteDir)} && node scripts/backup-dump.js --stdout`;
  const sshArgs = [...parseSshArgs(sshExtra), sshTarget, remoteCmd];

  console.error("[backup-pull] SSH →", sshTarget, "cwd remoto:", remoteDir);
  console.error("[backup-pull] Guardando en", outFile);

  const ssh = spawn("ssh", sshArgs, { stdio: ["ignore", "pipe", "inherit"] });
  const ws = fs.createWriteStream(outFile);

  ssh.stdout.pipe(ws);

  ssh.on("error", (err) => {
    console.error("[backup-pull] ssh:", err.message);
    try {
      fs.unlinkSync(outFile);
    } catch (_) {
      /* ignore */
    }
    process.exit(1);
  });

  ssh.on("close", (code) => {
    if (code !== 0) {
      try {
        ws.destroy();
      } catch (_) {
        /* ignore */
      }
      try {
        fs.unlinkSync(outFile);
      } catch (_) {
        /* ignore */
      }
      console.error("[backup-pull] ssh terminó con código", code);
      process.exit(code == null ? 1 : code);
    }

    const finalize = () => {
      let size = 0;
      try {
        size = fs.statSync(outFile).size;
      } catch (_) {
        /* ignore */
      }
      if (size < 512) {
        console.error("[backup-pull] El archivo es demasiado pequeño; revisá stderr de pg_dump arriba.");
        process.exit(1);
      }
      console.error("[backup-pull] OK", outFile, `(${Math.round(size / 1024)} KiB)`);
    };

    if (ws.writableFinished) finalize();
    else ws.once("finish", finalize);
  });
}

function shellQuote(s) {
  if (!/[^\w@%+=:,./-]/.test(s)) return s;
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

main();
