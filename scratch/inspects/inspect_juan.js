"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== SEARCHING FOR JUAN BARREIRO / 92281419121 ===");
    
    // 1. Search in usuarios
    console.log("\n--- SCHEMA OF USUARIOS ---");
    const resSchema = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'usuarios'`
    );
    for (const row of resSchema.rows) {
      console.log(`- ${row.column_name} (${row.data_type})`);
    }

    console.log("\n--- USUARIOS ---");
    const resUsers = await pool.query(
      `SELECT * FROM usuarios WHERE nombre ILIKE '%Juan%' OR whatsapp_jid ILIKE '%2281%' OR whatsapp ILIKE '%2281%' OR whatsapp ILIKE '%9121%'`
    );
    console.log(`Found ${resUsers.rows.length} rows in usuarios:`);
    for (const r of resUsers.rows) {
      console.log(JSON.stringify(r, null, 2));
    }

    if (resUsers.rows.length > 0) {
      const user = resUsers.rows[0];
      const userId = user.id;
      const userJid = user.whatsapp_jid;
      const userPhone = user.whatsapp_real;
      const userWa = user.whatsapp;

      // 2. Search in onboarding_estado
      console.log("\n--- SCHEMA OF ONBOARDING_ESTADO ---");
      const resOnbSchema = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'onboarding_estado'`
      );
      for (const row of resOnbSchema.rows) {
        console.log(`- ${row.column_name} (${row.data_type})`);
      }
      
      console.log("\n--- ONBOARDING ESTADO ---");
      // We will look for whatsapp
      const resOnboard = await pool.query(
        `SELECT * FROM onboarding_estado WHERE whatsapp = $1 OR whatsapp = $2`,
        [userWa, userPhone]
      );
      for (const r of resOnboard.rows) {
        console.log(JSON.stringify(r, null, 2));
      }

      // 3. Search in conversacion_estado
      console.log("\n--- SCHEMA OF CONVERSACION_ESTADO ---");
      const resConvSchema = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'conversacion_estado'`
      );
      for (const row of resConvSchema.rows) {
        console.log(`- ${row.column_name} (${row.data_type})`);
      }

      console.log("\n--- CONVERSACION ESTADO ---");
      const resConv = await pool.query(
        `SELECT * FROM conversacion_estado WHERE whatsapp = $1 OR whatsapp = $2`,
        [userWa, userPhone]
      );
      for (const r of resConv.rows) {
        console.log(JSON.stringify(r, null, 2));
      }

      // 4. Search in historial_consultas
      console.log("\n--- HISTORIAL CONSULTAS ---");
      const resHist = await pool.query(
        `SELECT id, creado_en, pregunta, respuesta, ia_provider, ia_sin_contexto FROM historial_consultas 
         WHERE usuario_id = $1 OR whatsapp = $2 OR whatsapp = $3
         ORDER BY creado_en ASC`,
        [userId, userPhone, userWa]
      );
      console.log(`Found ${resHist.rows.length} rows:`);
      for (const r of resHist.rows) {
        console.log(`[${r.creado_en.toISOString()}] ID: ${r.id} | Provider: ${r.ia_provider} | Sin Contexto: ${r.ia_sin_contexto}
Q: "${r.pregunta}"
A: "${r.respuesta}"
----------------------------------------`);
      }

      // 5. Search in whatsapp_interaccion_log
      console.log("\n--- WHATSAPP INTERACCION LOG ---");
      const resLog = await pool.query(
        `SELECT creado_en, whatsapp_norm, direccion, cuerpo, ruta FROM whatsapp_interaccion_log 
         WHERE whatsapp_norm = $1 OR whatsapp_norm = $2 OR usuario_id = $3
         ORDER BY creado_en ASC`,
        [userPhone, userWa, userId]
      );
      console.log(`Found ${resLog.rows.length} rows:`);
      for (const r of resLog.rows) {
        console.log(`[${r.creado_en.toISOString()}] ${r.direccion.toUpperCase()} | Ruta: ${r.ruta}
Cuerpo: "${r.cuerpo}"
----------------------------------------`);
      }
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
