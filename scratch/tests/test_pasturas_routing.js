"use strict";

require("dotenv").config();
const { clasificarMensaje } = require("./src/services/clasificador");
const { routear } = require("./src/services/router");
const { pool } = require("./src/config/database");

async function test() {
  console.log("==> Iniciando test de clasificación y ruteo de Pasturas");

  // Buscar el ID real de Carlos Gomez de Tandil en la DB
  const resUser = await pool.query("SELECT id FROM usuarios WHERE whatsapp = $1", ["5491199820888"]);
  const realId = resUser.rows[0]?.id;
  if (!realId) {
    console.error("ERROR: No se encontró el usuario Carlos Gomez (5491199820888) en la base de datos.");
    await pool.end();
    return;
  }

  // Configurar pasturas para el showoff premium
  console.log("==> Configurando pasturas en Base de Datos para el test...");
  await pool.query("UPDATE lotes SET cultivo = 'Alfalfa', hectareas = 50 WHERE usuario_id = $1 AND nombre = 'Bajo Grande'", [realId]);
  
  const resLoteChico = await pool.query("SELECT id FROM lotes WHERE usuario_id = $1 AND nombre = 'Bajo Chico'", [realId]);
  if (!resLoteChico.rows.length) {
    await pool.query("INSERT INTO lotes (usuario_id, nombre, hectareas, cultivo) VALUES ($1, 'Bajo Chico', 30, 'Festuca')", [realId]);
  } else {
    await pool.query("UPDATE lotes SET cultivo = 'Festuca', hectareas = 30 WHERE usuario_id = $1 AND nombre = 'Bajo Chico'", [realId]);
  }

  const usuarioSimulado = {
    id: realId,
    nombre: "Carlos Gomez",
    partido: "Tandil",
    provincia: "Buenos Aires",
    perfil_productivo: "ganaderia",
  };

  const consultas = [
    "Cómo viene la rotación de mis pasturas?",
    "Mostrame el estado de mis lotes"
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
