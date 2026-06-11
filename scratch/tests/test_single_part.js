"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { buscarPorWhatsapp } = require("../src/models/usuario");
const { rutaRegistrar } = require("../src/services/rutas/registrar");

async function main() {
  console.log("=== TESTING SINGLE BIRTH REGISTRATION ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const resU = await pool.query("SELECT * FROM usuarios ORDER BY id DESC LIMIT 5");
    const usuario = resU.rows[0];
    console.log("Using user profile:", usuario.nombre, "ID:", usuario.id);

    const msg = "Hoy nacieron 2 terneros";
    console.log(`\nInput Message: "${msg}"`);
    const resp = await rutaRegistrar({
      mensaje: msg,
      usuario,
      numeroWhatsapp: "5492494468949",
    });

    console.log("\n--- Pipeline Out ---");
    console.log(resp);
    console.log("--------------------");

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
