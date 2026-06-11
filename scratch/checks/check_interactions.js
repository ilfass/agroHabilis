"use strict";

require("dotenv").config();
const { pool } = require("../src/config/database");

const targetPhone = "5492494695814";

async function checkInteractions() {
  console.log(`🔎 Buscando interacciones en base de datos para el número: ${targetPhone}...\n`);
  
  try {
    // 1. Consultar historial_consultas
    console.log("--- HISTORIAL DE CONSULTAS (historial_consultas) ---");
    const rHist = await pool.query(
      `
        SELECT creado_en, pregunta, respuesta, ia_provider, ia_sin_contexto
        FROM historial_consultas
        WHERE whatsapp = $1 OR whatsapp LIKE $2
        ORDER BY creado_en DESC
        LIMIT 15
      `,
      [targetPhone, `%${targetPhone}%`]
    );
    
    if (rHist.rows.length === 0) {
      console.log("No se encontraron registros en historial_consultas.");
    } else {
      for (const row of rHist.rows) {
        console.log(`[${row.creado_en.toISOString()}]`);
        console.log(`👤 Usuario: "${row.pregunta}"`);
        console.log(`🤖 Agente: "${row.respuesta}"`);
        console.log(`Provider: ${row.ia_provider} | Sin Contexto: ${row.ia_sin_contexto}`);
        console.log("--------------------------------------------------------------------------------");
      }
    }
    
    // 2. Consultar whatsapp_interaccion_log
    console.log("\n--- REGISTROS COMPLETOS DE ENTRADA/SALIDA (whatsapp_interaccion_log) ---");
    const rLog = await pool.query(
      `
        SELECT creado_en, direccion, cuerpo, ruta
        FROM whatsapp_interaccion_log
        WHERE whatsapp_norm = $1 OR whatsapp_norm LIKE $2
        ORDER BY creado_en DESC
        LIMIT 25
      `,
      [targetPhone, `%${targetPhone}%`]
    );
    
    if (rLog.rows.length === 0) {
      console.log("No se encontraron registros en whatsapp_interaccion_log.");
    } else {
      for (const row of rLog.rows) {
        const dirSymbol = row.direccion === "in" ? "📥 IN" : "📤 OUT";
        console.log(`[${row.creado_en.toISOString()}] ${dirSymbol} | Ruta: ${row.ruta || "n/d"}`);
        console.log(`Cuerpo: "${row.cuerpo}"`);
        console.log("--------------------------------------------------------------------------------");
      }
    }

  } catch (error) {
    console.error("Error al consultar la base de datos:", error.message);
  } finally {
    await pool.end();
  }
}

checkInteractions();
