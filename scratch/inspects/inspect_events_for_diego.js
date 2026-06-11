"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("=== INSPECTING EVENTS & HISTORY FOR DIEGO FIGUEROA ===");
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    const num1 = "208683921358918";
    const num2 = "5492494218078";

    // 1. Search in consulta_route_events
    const resEvents = await pool.query(
      `SELECT creado_en, whatsapp, route, estado, cultivo, faltantes, inconsistente 
       FROM consulta_route_events 
       WHERE whatsapp LIKE $1 OR whatsapp LIKE $2
       ORDER BY creado_en DESC LIMIT 30`,
      [`%${num1}%`, `%${num2}%`]
    );
    console.log(`\nFound ${resEvents.rows.length} records in 'consulta_route_events':`);
    for (const r of resEvents.rows) {
      console.log(`[${r.creado_en.toISOString()}] WA: ${r.whatsapp} | Route: ${r.route} | Estado: ${r.estado} | Cultivo: ${r.cultivo} | Faltantes: ${r.faltantes}`);
    }

    // 2. Search in historial_consultas for both numbers
    const resHistory = await pool.query(
      `SELECT creado_en, usuario_id, whatsapp, pregunta, respuesta FROM historial_consultas 
       WHERE whatsapp LIKE $1 OR whatsapp LIKE $2 OR pregunta LIKE $1 OR pregunta LIKE $2
       ORDER BY creado_en DESC LIMIT 30`,
      [`%${num1}%`, `%${num2}%`]
    );
    console.log(`\nFound ${resHistory.rows.length} records in 'historial_consultas':`);
    for (const r of resHistory.rows) {
      console.log(`[${r.creado_en.toISOString()}] UserID: ${r.usuario_id} | WA: ${r.whatsapp}\nQ: ${r.pregunta}\nA: ${r.respuesta}\n`);
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
