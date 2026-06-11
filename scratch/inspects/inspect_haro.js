"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING FABIAN DE HARO ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    // 1. Search in usuarios
    const resUsers = await pool.query(
      `SELECT id, nombre, plan, whatsapp, whatsapp_jid, whatsapp_real, activo FROM usuarios 
       WHERE nombre ILIKE '%haro%' OR nombre ILIKE '%fabian%' OR whatsapp LIKE '%2494468949%' OR whatsapp_real LIKE '%2494468949%' OR whatsapp_jid LIKE '%2494468949%'`
    );
    console.log("=== Users Found ===");
    console.log(JSON.stringify(resUsers.rows, null, 2));

    const userIds = resUsers.rows.map(r => r.id);
    console.log("User IDs found:", userIds);

    // 2. Search in whatsapp_interaccion_log
    console.log("\n=== WhatsApp Interaction Log (recent 40) ===");
    let queryLogs, paramsLogs;
    if (userIds.length > 0) {
      queryLogs = `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
                   WHERE usuario_id ANY($1) OR whatsapp_norm LIKE '%2494468949%' OR cuerpo ILIKE '%haro%' OR cuerpo ILIKE '%fabian%'
                   ORDER BY creado_en DESC LIMIT 40`;
      paramsLogs = [userIds];
    } else {
      queryLogs = `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
                   WHERE whatsapp_norm LIKE '%2494468949%' OR cuerpo ILIKE '%haro%' OR cuerpo ILIKE '%fabian%'
                   ORDER BY creado_en DESC LIMIT 40`;
      paramsLogs = [];
    }
    // Let's just do a direct query without ANY if it's simpler
    const resLogs = await pool.query(
      `SELECT creado_en, whatsapp_norm, usuario_id, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
       WHERE whatsapp_norm LIKE '%2494468949%' OR cuerpo ILIKE '%haro%' OR cuerpo ILIKE '%2494468949%'
       ORDER BY creado_en DESC LIMIT 60`
    );
    console.log(`Found ${resLogs.rows.length} interaction log rows:`);
    for (const r of resLogs.rows) {
      console.log(`[${r.creado_en.toISOString()}] User: ${r.usuario_id} | Norm: ${r.whatsapp_norm} | ${r.direccion.toUpperCase()}: ${r.cuerpo} (Ruta: ${r.ruta})`);
    }

    // 3. Search in historial_consultas
    console.log("\n=== Historial Consultas (recent 40) ===");
    const resQueries = await pool.query(
      `SELECT id, creado_en, usuario_id, pregunta, respuesta, ia_provider FROM historial_consultas 
       WHERE pregunta ILIKE '%haro%' OR pregunta ILIKE '%2494468949%' OR respuesta ILIKE '%haro%' OR respuesta ILIKE '%2494468949%'
       ORDER BY creado_en DESC LIMIT 40`
    );
    console.log(`Found ${resQueries.rows.length} query history rows:`);
    for (const r of resQueries.rows) {
      console.log(`[${r.creado_en.toISOString()}] ID: ${r.id} | User: ${r.usuario_id} | Pregunta: ${r.pregunta}\nRespuesta: ${r.respuesta.substring(0, 150)}...\n`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
