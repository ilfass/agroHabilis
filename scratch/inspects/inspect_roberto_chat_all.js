"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== DETAILED ROBERTO INSPECTOR ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    // 1. Find user details
    const resUser = await pool.query(
      `SELECT id, nombre, email, whatsapp, whatsapp_jid, whatsapp_real, plan, activo 
       FROM usuarios 
       WHERE whatsapp LIKE '%2494468949%' OR whatsapp_real LIKE '%2494468949%' OR nombre LIKE '%Roberto%'`
    );
    console.log("\n--- Users found ---");
    console.log(resUser.rows);

    const userIds = resUser.rows.map(r => r.id);
    const userIdPlaceholder = userIds.length > 0 ? userIds.join(",") : "0";

    // 2. Fetch whatsapp_interaccion_log for Roberto
    const resLogs = await pool.query(
      `SELECT id, creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta 
       FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE '%2494468949%' OR usuario_id IN (${userIdPlaceholder})
       ORDER BY creado_en ASC`
    );
    console.log(`\n--- whatsapp_interaccion_log entries (${resLogs.rows.length}) ---`);
    for (const r of resLogs.rows) {
      console.log(`\n[ID: ${r.id}] [${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()}: "${r.cuerpo}" (Ruta: ${r.ruta}, UserID: ${r.usuario_id}, WA: ${r.whatsapp_norm})`);
    }

    // 3. Fetch historial_consultas for Roberto
    const resHistorial = await pool.query(
      `SELECT id, creado_en, usuario_id, whatsapp, pregunta, respuesta, ia_provider 
       FROM historial_consultas 
       WHERE whatsapp LIKE '%2494468949%' OR usuario_id IN (${userIdPlaceholder})
       ORDER BY creado_en ASC`
    );
    console.log(`\n--- historial_consultas entries (${resHistorial.rows.length}) ---`);
    for (const r of resHistorial.rows) {
      console.log(`\n[ID: ${r.id}] [${r.creado_en.toISOString()}] IA: ${r.ia_provider}, UserID: ${r.usuario_id}, WA: ${r.whatsapp}\n  Q: "${r.pregunta}"\n  A: "${r.respuesta}"`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
