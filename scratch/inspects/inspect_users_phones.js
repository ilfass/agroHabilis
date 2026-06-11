"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const resCountPhones = await pool.query("SELECT COUNT(*) FROM telefonos_autorizados");
    console.log("Count in telefonos_autorizados:", resCountPhones.rows[0].count);

    const resCountUsers = await pool.query("SELECT COUNT(*) FROM usuarios");
    console.log("Count in usuarios:", resCountUsers.rows[0].count);

    // Let's find Roberto's details (User 521)
    const resRoberto = await pool.query("SELECT * FROM usuarios WHERE id = 521");
    console.log("Roberto Gimenez details:", resRoberto.rows);

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
