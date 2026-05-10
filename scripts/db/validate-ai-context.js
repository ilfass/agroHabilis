#!/usr/bin/env node
/**
 * Verifica archivos de contexto IA requeridos para prompts.
 * Falla si falta alguno o si esta vacio.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const required = [
  "docs/fuentes/fuentes-curadas.md",
  "docs/contexto-ia/guia-respuestas.md",
  "docs/operacion/casos-entrenamiento.md",
];

let ok = true;
for (const rel of required) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`FALTA: ${rel}`);
    ok = false;
    continue;
  }
  const raw = fs.readFileSync(abs, "utf8");
  const nonEmpty = String(raw || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!nonEmpty.length) {
    console.error(`VACIO: ${rel}`);
    ok = false;
    continue;
  }
  console.log(`OK: ${rel} (${nonEmpty.length} lineas no vacias)`);
}

if (!ok) {
  console.error("Validacion de contexto IA FALLIDA.");
  process.exit(1);
}

console.log("Validacion de contexto IA OK.");
