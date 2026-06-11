"use strict";

// Load environment variables from .env
require("dotenv").config();

const { Pool } = require("pg");
const { registrarDatoGanadero } = require("../src/services/rutas/registrar");
const { buscarPorWhatsapp } = require("../src/models/usuario");

async function main() {
  const connStr = process.env.DATABASE_URL;
  console.log("Using Database URL:", connStr);
  const pool = new Pool({ connectionString: connStr });

  // Patch database service to use our pool
  const db = require("../src/config/database");
  db.query = (text, params) => pool.query(text, params);

  try {
    console.log("=== STEP 1: RESOLVING USER PERFIL ===");
    const usuario = await buscarPorWhatsapp("3753918865442");
    console.log("Resolved user:", JSON.stringify(usuario, null, 2));

    if (!usuario) {
      console.log("User not found!");
      return;
    }

    console.log("\n=== STEP 2: RUNNING registrarDatoGanadero MANUALLY ===");
    const result = await registrarDatoGanadero({
      texto: "Registrar 50 vacas en el lote 8, tres fueron vacunas",
      usuarioId: usuario.id,
      numeroWhatsapp: "3753918865442",
    });

    console.log("Result of registrarDatoGanadero:", result);

    console.log("\n=== STEP 3: CHECKING DB FOR MOVEMENTS FOR USER ===");
    const resMovs = await pool.query(
      `SELECT * FROM inventario_movimiento WHERE usuario_id = $1`,
      [usuario.id]
    );
    console.log("Movements in DB:", JSON.stringify(resMovs.rows, null, 2));

  } catch (err) {
    console.error("Error during manual execution test:", err);
  } finally {
    await pool.end();
  }
}

main();
