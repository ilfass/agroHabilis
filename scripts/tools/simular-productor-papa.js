#!/usr/bin/env node
/**
 * Simulación de un productor de papa: onboarding + consultas (misma ruta que WhatsApp).
 *
 * Uso:
 *   node scripts/tools/simular-productor-papa.js
 *   SIM_PAPA_WHATSAPP=5491199820999 node scripts/tools/simular-productor-papa.js --clean
 *
 * Solo permite --clean si el número coincide con el prefijo de prueba (54911998209...) por seguridad.
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { query } = require("../../src/config/database");
const { normalizarWhatsapp } = require("../../src/models/usuario");
const { gestionarOnboarding } = require("../../src/services/onboarding");
const { procesarConsulta } = require("../../src/services/consultas");

const DEFAULT_WA = process.env.SIM_PAPA_WHATSAPP || "5491199820999";

const TURNOS = [
  "Hola",
  "Valentina Ruiz",
  "Buenos Aires, Balcarce",
  "papa",
  "a cuanto esta la papa en el mercado central hoy?",
  "laburo Spunta y Kennebec, el precio que mostras es para que calibre?",
  "me conviene largar a industria o espero por retail?",
  "que dia es hoy",
];

/** Solo números de prueba en el rango del proyecto (54911998209…). */
const permiteLimpiar = (wa) => String(wa).replace(/\D/g, "").startsWith("54911998209");

async function limpiarUsuarioPrueba(waNorm) {
  await query(`DELETE FROM historial_consultas WHERE whatsapp = $1 OR whatsapp = $2`, [waNorm, waNorm.replace(/^54/, "")]);
  await query(`DELETE FROM onboarding_estado WHERE whatsapp = $1`, [waNorm]);
  const u = await query(`SELECT id FROM usuarios WHERE whatsapp = $1`, [waNorm]);
  const id = u.rows[0]?.id;
  if (id) {
    await query(`DELETE FROM usuario_cultivos WHERE usuario_id = $1`, [id]);
    await query(`DELETE FROM usuarios WHERE id = $1`, [id]);
  }
}

async function unTurno(wa, texto) {
  const t0 = Date.now();
  const ob = await gestionarOnboarding(wa, texto);
  if (ob.enOnboarding) {
    return {
      user: texto,
      bot: String(ob.respuesta || ""),
      ms: Date.now() - t0,
      route: "onboarding",
    };
  }
  const bot = await procesarConsulta(wa, texto);
  return {
    user: texto,
    bot: String(bot || ""),
    ms: Date.now() - t0,
    route: "consulta",
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const clean = argv.includes("--clean");
  const waRaw = argv.find((a) => /^\d{10,15}$/.test(a)) || DEFAULT_WA;
  const wa = normalizarWhatsapp(waRaw);

  if (clean) {
    if (!permiteLimpiar(wa)) {
      console.error("Refusing --clean: use SIM_PAPA_WHATSAPP=54911998209xxxxxx (rango de prueba).");
      process.exit(1);
    }
    await limpiarUsuarioPrueba(wa);
    console.error(`Limpieza OK: ${wa}`);
  }

  const conv = [];
  for (const texto of TURNOS) {
    const row = await unTurno(wa, texto);
    conv.push(row);
    console.error(`[${row.route}] ${texto.slice(0, 50)}... -> ${row.ms} ms`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    whatsapp: wa,
    productor: "papa_balcarce",
    nombre: "Valentina Ruiz",
    turnos: TURNOS.length,
    conv,
  };

  const outPath = path.join(
    __dirname,
    "..",
    "..",
    "docs",
    "operacion",
    `simulacion-productor-papa-${new Date().toISOString().slice(0, 10)}.json`,
  );
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.error(`Escrito: ${outPath}`);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
