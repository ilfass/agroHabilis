"use strict";

const { Pool } = require("pg");
const fs = require("fs");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    // 1. Search in usuarios
    const resUsers = await pool.query(
      `SELECT * FROM usuarios 
       WHERE id = 487 OR whatsapp LIKE '%2494468949%' OR whatsapp_real LIKE '%2494468949%' OR whatsapp_jid LIKE '%2494468949%'`
    );
    console.log("=== USERS ===");
    console.log(JSON.stringify(resUsers.rows, null, 2));

    // 2. Search all delegates in telefonos_autorizados
    const resDelegates = await pool.query(
      `SELECT * FROM telefonos_autorizados WHERE usuario_principal_id = 487 OR whatsapp_autorizado LIKE '%2494218078%' OR whatsapp_autorizado LIKE '%2281548505%'`
    );
    console.log("\n=== DELEGATES ===");
    console.log(JSON.stringify(resDelegates.rows, null, 2));

    // 3. Search in whatsapp_interaccion_log for all these numbers
    const resLogs = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm IN ('5492494468949', '5492494218078', '5492281548505')
       ORDER BY creado_en DESC LIMIT 150`
    );
    
    let logOutput = "=== WHATSAPP INTERACTION LOG ===\n";
    for (const r of resLogs.rows) {
      logOutput += `[${r.creado_en.toISOString()}] Num: ${r.whatsapp_norm} | UserID: ${r.usuario_id} | ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})\n`;
    }
    fs.writeFileSync("scratch/detailed_logs.txt", logOutput);
    console.log("\nWritten 150 log entries to scratch/detailed_logs.txt");

    // 4. Search in historial_consultas for these numbers/users
    const resQueries = await pool.query(
      `SELECT id, creado_en, usuario_id, pregunta, respuesta, ia_provider FROM historial_consultas 
       WHERE usuario_id = 487 OR pregunta ILIKE '%Diego%' OR respuesta ILIKE '%Diego%'
       ORDER BY creado_en DESC LIMIT 50`
    );
    let queryOutput = "=== HISTORIAL CONSULTAS ===\n";
    for (const r of resQueries.rows) {
      queryOutput += `\n[${r.creado_en.toISOString()}] ID: ${r.id} | User: ${r.usuario_id} | Provider: ${r.ia_provider}\nIN: ${r.pregunta}\nOUT: ${r.respuesta}\n`;
    }
    fs.writeFileSync("scratch/detailed_queries.txt", queryOutput);
    console.log("Written 50 queries to scratch/detailed_queries.txt");

    // 5. Let's see if there are any specific data tables like 'ventas', 'gastos', 'ganado', etc.
    const resTables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
    );
    console.log("\n=== TABLES IN DATABASE ===");
    console.log(resTables.rows.map(r => r.table_name).join(", "));

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
