"use strict";

const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    console.log("=== ACTIVE WEB SESSIONS ===");
    const resSessions = await pool.query(
      `SELECT s.id, s.usuario_id, s.ip, s.creado_en, s.expires_at, s.revocada_en, u.nombre, u.email, u.whatsapp
       FROM cliente_auth_sessions s
       LEFT JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.expires_at > NOW() AND s.revocada_en IS NULL
       ORDER BY s.creado_en DESC`
    );
    for (const r of resSessions.rows) {
      console.log(`Session ID: ${r.id}, User ID: ${r.usuario_id}, Name: "${r.nombre}", WhatsApp: "${r.whatsapp}", Created: ${r.creado_en.toISOString()}, Expire: ${r.expires_at.toISOString()}`);
    }

    console.log("\n=== ALL WEB SESSIONS (Last 10) ===");
    const resAllSessions = await pool.query(
      `SELECT s.id, s.usuario_id, s.ip, s.creado_en, s.expires_at, s.revocada_en, u.nombre, u.email, u.whatsapp
       FROM cliente_auth_sessions s
       LEFT JOIN usuarios u ON u.id = s.usuario_id
       ORDER BY s.creado_en DESC LIMIT 10`
    );
    for (const r of resAllSessions.rows) {
      console.log(`Session ID: ${r.id}, User ID: ${r.usuario_id}, Name: "${r.nombre}", WhatsApp: "${r.whatsapp}", Expire: ${r.expires_at.toISOString()}, Revoked: ${r.revocada_en ? r.revocada_en.toISOString() : 'no'}`);
    }

    console.log("\n=== WEB CREDENTIALS ===");
    const resCreds = await pool.query(
      `SELECT c.usuario_id, c.telefono_norm, u.nombre, u.whatsapp 
       FROM cliente_auth_credentials c
       LEFT JOIN usuarios u ON u.id = c.usuario_id`
    );
    for (const r of resCreds.rows) {
      console.log(`User ID: ${r.usuario_id}, Telefono Norm: "${r.telefono_norm}", Name: "${r.nombre}", WhatsApp: "${r.whatsapp}"`);
    }
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}

main();
