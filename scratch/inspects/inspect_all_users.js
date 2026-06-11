"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING ALL USERS ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const res = await pool.query(
      `SELECT id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, plan, activo 
       FROM usuarios 
       ORDER BY id DESC LIMIT 50`
    );
    for (const r of res.rows) {
      console.log(`ID: ${r.id} | Name: ${r.nombre} | WA: ${r.whatsapp} | JID: ${r.whatsapp_jid} | Real: ${r.whatsapp_real} | Plan: ${r.plan}`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
