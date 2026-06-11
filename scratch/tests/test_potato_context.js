"use strict";

require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  console.log("=== Testing Potato Context Injection ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  const db = require("../src/config/database");
  db.query = (text, params) => pool.query(text, params);

  const { procesarConsulta } = require("../src/services/consultas");

  try {
    const wa = "5492494468949"; // Néstor
    const pregunta = "Sí, pasame cómo está la Spunta hoy en Mercado Central y si tenés alguna referencia de Balcarce mejor.";
    
    console.log("Processing query...");
    const respuesta = await procesarConsulta(wa, pregunta);
    console.log("\n--- AGENT RESPONSE ---");
    console.log(respuesta);
    console.log("----------------------");
  } catch (err) {
    console.error("Error running query test:", err);
  } finally {
    await pool.end();
  }
}

main();
