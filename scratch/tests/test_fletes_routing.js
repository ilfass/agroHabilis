"use strict";

require("dotenv").config();
const { clasificarMensaje } = require("./src/services/clasificador");
const { routear } = require("./src/services/router");
const { pool } = require("./src/config/database");

async function test() {
  console.log("==> Iniciando test de clasificación y ruteo de Fletes");

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
    "Cuánto me sale el flete de Tandil a Rosario para 30 toneladas?",
    "Me ofrecen $250.000 por la soja en Tandil, me conviene venderla local o asumir el flete a Rosario?"
  ];

  for (const c of consultas) {
    console.log("\n----------------------------------------");
    console.log(`Consulta: "${c}"`);
    
    console.log("==> Clasificando...");
    const clas = await clasificarMensaje(c, usuarioSimulado);
    console.log("Intención elegida:", clas.intencion);
    console.log("Variantes / Info extra:", JSON.stringify({
      cultivo: clas.cultivo,
      producto: clas.producto,
      variante_precio: clas.variante_precio
    }));

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
