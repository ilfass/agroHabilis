"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { buscarPorWhatsapp } = require("../src/models/usuario");
const { rutaRegistrar } = require("../src/services/rutas/registrar");

async function main() {
  console.log("=== TESTING COMPOSITE MESSAGE SPLITTING IN REGISTRAR ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    // Debug: List top users in this DB connection
    const resUsers = await pool.query("SELECT id, nombre FROM usuarios ORDER BY id DESC LIMIT 5");
    console.log("Top users in database:", resUsers.rows);
    const usuario = resUsers.rows.find(u => u.nombre.includes("Roberto")) || resUsers.rows[0];
    if (!usuario) {
      console.error("No users found in DB!");
      return;
    }
    console.log("Using user profile:", usuario.nombre, "ID:", usuario.id);

    // 2. Test composite message
    const msg = "Hoy nacieron 2 terneros y ayer gasté 185 mil en alimento";
    console.log(`\nInput Message: "${msg}"`);
    console.log("Running registration pipeline...");
    const resp = await rutaRegistrar({
      mensaje: msg,
      usuario,
      numeroWhatsapp: "5492494468949",
    });

    console.log("\n--- Pipeline Out ---");
    console.log(resp);
    console.log("--------------------");

    // 3. Check if the gasto was inserted
    const resGasto = await pool.query(
      `SELECT id, creado_en, categoria, descripcion, monto 
       FROM gastos 
       WHERE usuario_id = $1 
       ORDER BY creado_en DESC LIMIT 1`,
      [usuario.id]
    );
    console.log("\nLast registered gasto in DB:");
    console.log(resGasto.rows);

    // 4. Check if the pending inventory movement was inserted
    const resMov = await pool.query(
      `SELECT id, creado_en, dominio, clase, efecto, payload, estado, texto_nl 
       FROM inventario_movimiento 
       WHERE usuario_id = $1 
       ORDER BY creado_en DESC LIMIT 1`,
      [usuario.id]
    );
    console.log("\nLast registered inventory movement (birth) in DB:");
    console.log(resMov.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
