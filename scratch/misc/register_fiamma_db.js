"use strict";

const { Pool } = require("pg");

async function main() {
  console.log("==> Registering Fiamma Mayora in Database via Tunnel...");

  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  const ownerId = 487; // fabian de haro
  const delegatePhone = "5492281548505"; // Fiamma Mayora
  const name = "Fiamma Mayora";
  const rol = "tractorista";

  try {
    const res = await pool.query(
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

    console.log("[SUCCESS] Registered in telefonos_autorizados:", res.rows[0]);

  } catch (error) {
    console.error("[ERROR] Failed database operation:", error.message || error);
  } finally {
    await pool.end();
  }
}

main();
