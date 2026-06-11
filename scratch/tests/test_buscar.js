"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { buscarPorWhatsapp } = require("../src/models/usuario");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const user = await buscarPorWhatsapp("208683921358918@lid");
    console.log("buscarPorWhatsapp('208683921358918@lid') returned:", user);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
