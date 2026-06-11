#!/usr/bin/env node
/**
 * Fusiona .env local con valores del .env remoto para SYNC_ENV=1.
 * Las claves en SYNC_ENV_MERGE_KEYS (coma-separadas) toman el valor del VPS
 * si en el remoto están definidas y no vacías (tras trim).
 *
 * Uso: node scripts/deploy/merge-env-for-vps-sync.js <remoto.env> <local.env>
 * Salida: .env fusionado por stdout.
 *
 * Por defecto SYNC_ENV_MERGE_KEYS=DATABASE_URL,WHATSAPP_SESSION_PATH,WHATSAPP_CLIENT_ID
 */
const fs = require("fs");

const DEFAULT_MERGE_KEYS = [
  "DATABASE_URL",
  "WHATSAPP_SESSION_PATH",
  "WHATSAPP_CLIENT_ID",
];

function mergeKeyList() {
  const raw = process.env.SYNC_ENV_MERGE_KEYS;
  if (!raw || !String(raw).trim()) return DEFAULT_MERGE_KEYS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseEnvAssignments(content) {
  const map = new Map();
  if (!content) return map;
  const assignRe =
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(assignRe);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function mergeLocalWithRemote(localContent, remoteMap, preserveKeys) {
  const preserve = new Set(preserveKeys);
  const keysSeenInLocal = new Set();
  const appliedFromRemote = [];
  const lines = localContent.split(/\r?\n/);
  const out = [];
  const assignRe =
    /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)([\s\S]*)$/;

  for (const line of lines) {
    const m = line.match(assignRe);
    if (m) {
      const [, lead, key, eq] = m;
      keysSeenInLocal.add(key);
      if (preserve.has(key)) {
        const rv = remoteMap.get(key);
        const trimmed = rv !== undefined ? String(rv).trim() : "";
        if (trimmed !== "") {
          const prev = m[4] !== undefined ? String(m[4]).trim() : "";
          if (prev !== trimmed) appliedFromRemote.push(key);
          out.push(`${lead}${key}${eq}${rv}`);
          continue;
        }
      }
    }
    out.push(line);
  }

  for (const key of preserveKeys) {
    if (keysSeenInLocal.has(key)) continue;
    const rv = remoteMap.get(key);
    const trimmed = rv !== undefined ? String(rv).trim() : "";
    if (trimmed === "") continue;
    appliedFromRemote.push(key);
    out.push(`${key}=${rv}`);
  }

  let result = out.join("\n");
  if (localContent.endsWith("\n") && !result.endsWith("\n")) result += "\n";
  return { text: result, appliedFromRemote };
}

function main() {
  const remotePath = process.argv[2];
  const localPath = process.argv[3];
  if (!localPath) {
    console.error(
      "Uso: node scripts/deploy/merge-env-for-vps-sync.js <remoto.env> <local.env>"
    );
    process.exit(1);
  }
  const remoteContent =
    remotePath && fs.existsSync(remotePath)
      ? fs.readFileSync(remotePath, "utf8")
      : "";
  const localContent = fs.readFileSync(localPath, "utf8");
  const remoteMap = parseEnvAssignments(remoteContent);
  const preserveKeys = mergeKeyList();
  const { text, appliedFromRemote } = mergeLocalWithRemote(
    localContent,
    remoteMap,
    preserveKeys
  );
  if (appliedFromRemote.length) {
    process.stderr.write(
      `merge-env-for-vps-sync: valores del VPS conservados (${appliedFromRemote.join(", ")})\n`
    );
  } else {
    process.stderr.write(
      "merge-env-for-vps-sync: sin sustituciones desde el remoto (claves vacias o ausentes en VPS)\n"
    );
  }
  process.stdout.write(text);
}

main();
