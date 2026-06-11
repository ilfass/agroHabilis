"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING PRODUCTION TEAMWORK RECORDS VIA TUNNEL ===");
  
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    // 1. Find Fabian de Haro (owner/user)
    const fabianUser = await pool.query(
      `SELECT id, nombre, plan, whatsapp, whatsapp_real FROM usuarios WHERE nombre ILIKE '%fabian%' OR whatsapp LIKE '%2494468949%' OR whatsapp_real LIKE '%2494468949%'`
    );
    console.log("\nFabian Users found:", fabianUser.rows);
    
    // 2. Find Fiamma Mayora
    const fiammaUser = await pool.query(
      `SELECT id, nombre, plan, whatsapp, whatsapp_real FROM usuarios WHERE nombre ILIKE '%fiamma%' OR whatsapp LIKE '%2281548505%' OR whatsapp_real LIKE '%2281548505%'`
    );
    console.log("\nFiamma Users in 'usuarios':", fiammaUser.rows);

    const fiammaDelegados = await pool.query(
      `SELECT * FROM telefonos_autorizados WHERE nombre_contacto ILIKE '%fiamma%' OR whatsapp_autorizado LIKE '%2281548505%'`
    );
    console.log("\nFiamma in 'telefonos_autorizados':", fiammaDelegados.rows);

    // 3. Conversation history with Fabian de Haro
    if (fabianUser.rows.length > 0) {
      const ownerId = fabianUser.rows[0].id;
      console.log(`\nLast 15 messages in 'historial_consultas' for Fabian (User ID: ${ownerId}):`);
      const fabianHistory = await pool.query(
        `SELECT creado_en, pregunta, respuesta FROM historial_consultas 
         WHERE usuario_id = $1 OR whatsapp LIKE '%2494468949%'
         ORDER BY creado_en DESC LIMIT 15`,
        [ownerId]
      );
      for (const h of fabianHistory.rows.reverse()) {
        console.log(`[${h.creado_en.toISOString()}] User: ${h.pregunta}\nBot: ${h.respuesta}\n`);
      }
    }

    // 4. Conversation history with Fiamma Mayora
    console.log(`\nLast 10 messages in 'historial_consultas' for Fiamma:`);
    const fiammaHistory = await pool.query(
      `SELECT creado_en, pregunta, respuesta FROM historial_consultas 
       WHERE whatsapp LIKE '%2281548505%'
       ORDER BY creado_en DESC LIMIT 10`
    );
    for (const h of fiammaHistory.rows.reverse()) {
      console.log(`[${h.creado_en.toISOString()}] User: ${h.pregunta}\nBot: ${h.respuesta}\n`);
    }

  } catch (err) {
    console.error("Error running queries:", err);
  } finally {
    await pool.end();
  }
}

main();
