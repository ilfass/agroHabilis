"use strict";

require("dotenv").config();
const { query, pool } = require("../src/config/database");

async function main() {
  console.log("==> Running VPS Manual Addition for Fiamma Mayora...");

  const ownerId = 487; // fabian de haro
  const delegatePhone = "5492281548505"; // Fiamma Mayora
  const name = "Fiamma Mayora";
  const rol = "tractorista";

  try {
    // 1. Insert/Upsert the team member delegate record
    const res = await query(
      `
        INSERT INTO telefonos_autorizados (usuario_principal_id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado)
        VALUES ($1, $2, $3, $4, true, false)
        ON CONFLICT (whatsapp_autorizado) DO UPDATE SET
          usuario_principal_id = EXCLUDED.usuario_principal_id,
          nombre_contacto = EXCLUDED.nombre_contacto,
          rol = EXCLUDED.rol,
          activo = EXCLUDED.activo,
          aceptado = EXCLUDED.aceptado
        RETURNING *
      `,
      [ownerId, delegatePhone, name, rol]
    );

    console.log("[DB] Delegated user successfully registered in database:", res.rows[0]);

    // 2. Load WhatsApp config and send the invitation message
    console.log("[WhatsApp] Loading WhatsApp module to send invitation...");
    const { sendMessage } = require("../src/config/whatsapp");
    
    const msgInvitacion = `¡Hola *${name}*! 🌾\n\n` +
      `*fabian de haro* te ha invitado a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rol.toUpperCase()}*.\n\n` +
      `Tu cuenta operará bajo los límites del **Plan Gratis** de AgroHabilis (con límite de 25 consultas semanales, 4 audios y hasta 2 fotos por semana).\n\n` +
      `Para aceptar esta invitación y poder registrar datos o consultar al asistente desde tu WhatsApp, respondé con la palabra *SI*.\n\n` +
      `Si querés rechazar la invitación, respondé *NO*.`;

    console.log(`[WhatsApp] Sending invitation to ${delegatePhone}...`);
    const sent = await sendMessage(delegatePhone, msgInvitacion);
    console.log("[WhatsApp] Message sent successfully! Message ID:", sent?.id?._serialized || sent?.id || "unknown");

  } catch (error) {
    console.error("[ERROR] Failed to run manual addition:", error.message || error);
  } finally {
    await pool.end();
    console.log("==> Finished execution.");
  }
}

main();
