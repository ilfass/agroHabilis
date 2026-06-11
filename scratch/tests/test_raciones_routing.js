"use strict";

require("dotenv").config();
const { clasificarMensaje } = require("./src/services/clasificador");
const { routear } = require("./src/services/router");
const { pool } = require("./src/config/database");

async function test() {
  console.log("==> Iniciando test de clasificación y ruteo de Raciones/Mixer");

  // Usuario simulado
  const usuarioSimulado = {
    id: 1,
    nombre: "Productor Test",
    partido: "Tandil",
    provincia: "Buenos Aires",
    perfil_productivo: "ganaderia y agricultura",
    cultivos: [
      { cultivo: "soja", rendimiento_qq_ha: 32, hectareas: 100 }
    ]
  };

  const consultas = [
    "Necesito formular una suplementación para 120 novillos de 350 kg promedio. ¿Cuánto cargo en el mixer hoy?",
    "Haceme una ración de feedlot para 200 terneros de 200 kg promedio"
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
      numeroWhatsapp: "123456789"
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
