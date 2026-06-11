#!/usr/bin/env node
/**
 * Simulación de un productor de ganadería: onboarding + registro de animales individuales (trazabilidad) + consultas.
 *
 * Uso:
 *   node scripts/tools/simular-productor-ganaderia.js
 *   SIM_GANADO_WHATSAPP=5491199820888 node scripts/tools/simular-productor-ganaderia.js --clean
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { query } = require("../../src/config/database");
const { normalizarWhatsapp } = require("../../src/models/usuario");
const { gestionarOnboarding } = require("../../src/services/onboarding");
const { procesarConsulta } = require("../../src/services/consultas");

const DEFAULT_WA = process.env.SIM_GANADO_WHATSAPP || "5491199820888";

const TURNOS = [
  "Hola",
  "Carlos Gomez",
  "Buenos Aires, Tandil",
  "ganaderia",
  "vacas, terneros",
  "quiero registrar 1 ternero caravana AR-105 de raza Aberdeen Angus, peso 180 kilos y sexo macho en el lote Bajo Grande",
  "SI",
  "SI",
  "tengo 1 vaca caravana AR-106 de raza Hereford preñada en el lote Bajo Grande, agregala",
  "SI",
  "registrale una observacion a la caravana AR-105 que dice: 'Tratado con antibiotico por neumonia'",
  "SI",
  "cuales son las cotizaciones del novillo en el mercado de Cañuelas hoy?",
  "mostrame mis animales individuales registrados"
];

/** Solo números de prueba en el rango del proyecto (5491199820…). */
const permiteLimpiar = (wa) => String(wa).replace(/\D/g, "").startsWith("5491199820");

async function limpiarUsuarioPrueba(waNorm) {
  await query(`DELETE FROM historial_consultas WHERE whatsapp = $1 OR whatsapp = $2`, [waNorm, waNorm.replace(/^54/, "")]);
  await query(`DELETE FROM onboarding_estado WHERE whatsapp = $1`, [waNorm]);
  const u = await query(`SELECT id FROM usuarios WHERE whatsapp = $1`, [waNorm]);
  const id = u.rows[0]?.id;
  if (id) {
    await query(`DELETE FROM animales_individuales WHERE usuario_id = $1`, [id]);
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
      console.error("Refusing --clean: use SIM_GANADO_WHATSAPP=5491199820xxxxxx (rango de prueba).");
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
    productor: "ganaderia_tandil",
    nombre: "Carlos Gomez",
    turnos: TURNOS.length,
    conv,
  };

  const outPath = path.join(
    __dirname,
    "..",
    "..",
    "docs",
    "operacion",
    `simulacion-productor-ganaderia-${new Date().toISOString().slice(0, 10)}.json`,
  );
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.error(`Escrito: ${outPath}`);
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
