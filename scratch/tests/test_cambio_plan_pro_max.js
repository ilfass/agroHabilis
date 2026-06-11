"use strict";

require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const connStr = "postgresql://postgres:postgres@127.0.0.1:15433/agrointel";
  const pool = new Pool({ connectionString: connStr });

  try {
    // 1. Encontrar un usuario de prueba (excluyendo id=1)
    const resUser = await pool.query(
      "SELECT id, nombre, plan FROM usuarios WHERE id <> 1 LIMIT 1"
    );

    if (resUser.rows.length === 0) {
      console.log("No se encontraron usuarios de prueba para verificar.");
      return;
    }

    const testUser = resUser.rows[0];
    console.log(`Usuario seleccionado para pruebas: ID: ${testUser.id}, Nombre: ${testUser.nombre}, Plan actual: ${testUser.plan}`);

    // 2. Intentar actualizar el plan a pro_max
    const planObjetivo = "pro_max";
    console.log(`Actualizando plan a '${planObjetivo}'...`);
    
    const rPlan = await pool.query(
      `
        UPDATE usuarios
        SET plan = $2, plan_activo_hasta = NULL
        WHERE id = $1
        RETURNING id, nombre, whatsapp, plan, activo
      `,
      [testUser.id, planObjetivo]
    );

    const updatedUser = rPlan.rows[0];
    console.log(`Resultado de actualización: ID: ${updatedUser.id}, Nombre: ${updatedUser.nombre}, Plan nuevo: ${updatedUser.plan}`);

    if (updatedUser.plan === "pro_max") {
      console.log("¡Éxito! El plan 'pro_max' fue actualizado correctamente en la base de datos.");
    } else {
      console.error("Fallo: El plan no coincide con 'pro_max'.");
    }

    // 3. Revertir al plan original
    console.log(`Revirtiendo al plan original '${testUser.plan}'...`);
    const rRevert = await pool.query(
      `
        UPDATE usuarios
        SET plan = $2, plan_activo_hasta = NULL
        WHERE id = $1
        RETURNING id, nombre, plan
      `,
      [testUser.id, testUser.plan || "gratis"]
    );
    console.log(`Restauración exitosa. Plan actual del usuario: ${rRevert.rows[0].plan}`);

  } catch (err) {
    console.error("Error ejecutando verificación:", err);
  } finally {
    await pool.end();
  }
}

main();
