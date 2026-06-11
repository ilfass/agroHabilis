"use strict";

require("dotenv").config();
const { clasificarMensaje } = require("./src/services/clasificador");
const { routear } = require("./src/services/router");
const { pool } = require("./src/config/database");

async function test() {
  console.log("==> Iniciando test de clasificación y ruteo de PDF/Planillas");

  const usuarioSimulado = {
    id: 1,
    nombre: "Carlos Gomez",
    partido: "Tandil",
    provincia: "Buenos Aires",
    perfil_productivo: "ganaderia",
  };

  const consultas = [
    "Necesito descargar la planilla de mis caravanas en PDF",
    "Quiero bajar el reporte clínico de sanidad en PDF"
  ];

  for (const c of consultas) {
    console.log("\n----------------------------------------");
    console.log(`Consulta: "${c}"`);
    
    console.log("==> Clasificando...");
    const clas = await clasificarMensaje(c, usuarioSimulado);
    console.log("Intención elegida:", clas.intencion);

    console.log("==> Ruteando y ejecutando cálculo...");
    const respuesta = await routear({
      clasificacion: clas,
      mensaje: c,
      usuario: usuarioSimulado,
      numeroWhatsapp: "5491199820888"
    });

    console.log("==> Respuesta generada:\n");
    console.log(respuesta);
  }

  await pool.end();
}

test().catch(async (e) => {
  console.error("Error en test:", e);
  try {
    await pool.end();
  } catch (_) {}
});
