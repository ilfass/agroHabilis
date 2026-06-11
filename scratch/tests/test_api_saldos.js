"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const { listarSaldos } = require("../src/services/inventario/core");

async function main() {
  try {
    console.log("=== CALLING listarSaldos FOR USER 521 ===");
    // Simulate what the index.js endpoint does
    const saldos = await listarSaldos({ usuarioId: 521 });
    console.log("Returned saldos rows count:", saldos.length);
    console.log(JSON.stringify(saldos, null, 2));

  } catch (err) {
    console.error("Error:", err);
  }
}

main().then(() => process.exit(0));
