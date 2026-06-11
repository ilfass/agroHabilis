"use strict";

require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const numeroWhatsapp = "5492494218078@c.us";
    const base = "5492494218078";
    const variantes = [base, "208683921358918"];

    // Query 1: Columnas de gastos
    const q1 = await pool.query(
      `
        SELECT column_name, data_type, character_maximum_length 
        FROM information_schema.columns 
        WHERE table_name = 'gastos'
      `
    );
    console.log("Columnas de 'gastos':", q1.rows);

    // Query 2: Columnas de inventario_saldo
    const q2 = await pool.query(
      `
        SELECT column_name, data_type, character_maximum_length 
        FROM information_schema.columns 
        WHERE table_name = 'inventario_saldo'
      `
    );
    console.log("Columnas de 'inventario_saldo':", q2.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
