"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");

async function run() {
  const userId = 575;
  const clientName = "Daedaz Sociedad Anónima";
  const fields = [
    "Don Martín",
    "Sol Naciente",
    "Tres Marías",
    "Miraflores",
    "Santa Lucía",
    "Nuevo Destino"
  ];
  
  console.log("Loading fields for Daedas Sociedad Anónima under user 575...");
  for (const name of fields) {
    const check = await query("SELECT id FROM lotes WHERE usuario_id = $1 AND nombre = $2", [userId, name]);
    if (check.rows.length === 0) {
      await query(
        `INSERT INTO lotes (usuario_id, nombre, cliente, hectareas, creado_en)
         VALUES ($1, $2, $3, 100.00, NOW())`,
        [userId, name, clientName]
      );
      console.log(`Lote "${name}" created.`);
    } else {
      await query(
        `UPDATE lotes SET cliente = $1 WHERE usuario_id = $2 AND nombre = $3`,
        [clientName, userId, name]
      );
      console.log(`Lote "${name}" already exists, updated client name.`);
    }
  }
  console.log("All Daedas Sociedad Anónima fields successfully loaded!");
}

run().catch(console.error);
