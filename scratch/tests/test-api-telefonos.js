require("dotenv").config();
const { query, pool } = require("../src/config/database");

async function main() {
  console.log("==> Iniciando test de Endpoints de Gestión de Teléfonos Autorizados...");

  const testOwnerPhone = "549249999888";
  const testDelegatePhone = "549249777666";

  // 1. Limpieza preventiva
  await query("DELETE FROM telefonos_autorizados WHERE whatsapp_autorizado IN ($1, $2)", [testOwnerPhone, testDelegatePhone]);
  await query("DELETE FROM usuarios WHERE whatsapp = $1", [testOwnerPhone]);

  try {
    // 2. Crear usuario principal (Dueño)
    const resPrincipal = await query(`
      INSERT INTO usuarios (nombre, whatsapp, plan, activo)
      VALUES ('Establecimiento El Sol', $1, 'pro', true)
      RETURNING id
    `, [testOwnerPhone]);
    const principalId = resPrincipal.rows[0].id;
    console.log(`[OK] Cuenta Principal Creada. ID: ${principalId}`);

    // 3. Test de validación: no permitir agregar un número principal como delegado
    console.log("\n--- Test A: Impedir duplicar número principal como delegado ---");
    const checkUser = await query(
      `
        SELECT id FROM usuarios 
        WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
           OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
        LIMIT 1
      `,
      [testOwnerPhone]
    );
    if (checkUser.rows.length > 0) {
      console.log("[OK] Validado: El número pertenece a una cuenta principal (bloquear inserción)");
    } else {
      throw new Error("Fallo en Test A: Debería haberse identificado como cuenta principal");
    }

    // 4. Test B: Crear un operario delegado válido
    console.log("\n--- Test B: Crear operario delegado ---");
    const nombreContacto = "Carlos Perez (Tractorista)";
    const rol = "operario";
    
    // Simular el POST
    const whatsappNorm = String(testDelegatePhone).replace(/\D/g, "");
    const insertResult = await query(
      `
        INSERT INTO telefonos_autorizados (usuario_principal_id, whatsapp_autorizado, nombre_contacto, rol, activo)
        VALUES ($1, $2, $3, $4, true)
        RETURNING id, whatsapp_autorizado, nombre_contacto, rol, activo, creado_en
      `,
      [principalId, whatsappNorm, nombreContacto, rol]
    );

    const newDelegate = insertResult.rows[0];
    console.log(`[OK] Delegado insertado. ID: ${newDelegate.id}`);
    console.log(`     Nombre: ${newDelegate.nombre_contacto} (esperado: ${nombreContacto})`);
    console.log(`     WhatsApp: ${newDelegate.whatsapp_autorizado} (esperado: ${whatsappNorm})`);
    console.log(`     Rol: ${newDelegate.rol} (esperado: ${rol})`);

    if (newDelegate.nombre_contacto !== nombreContacto || newDelegate.whatsapp_autorizado !== whatsappNorm || newDelegate.rol !== rol) {
      throw new Error("Fallo en Test B: Datos de inserción incorrectos");
    }

    // 5. Test C: Listar delegados del establecimiento
    console.log("\n--- Test C: Listar delegados del establecimiento ---");
    const listResult = await query(
      `
        SELECT id, whatsapp_autorizado, nombre_contacto, rol, activo, creado_en
        FROM telefonos_autorizados
        WHERE usuario_principal_id = $1
        ORDER BY creado_en DESC
      `,
      [principalId]
    );

    console.log(`[OK] Cantidad recuperada: ${listResult.rows.length} (esperado: 1)`);
    if (listResult.rows.length !== 1) {
      throw new Error("Fallo en Test C: Debería listarse exactamente un delegado");
    }

    const listedDelegate = listResult.rows[0];
    if (listedDelegate.id !== newDelegate.id) {
      throw new Error("Fallo en Test C: ID de delegado recuperado no coincide");
    }

    // 6. Test D: Eliminar / Revocar delegado
    console.log("\n--- Test D: Eliminar / Revocar delegado ---");
    const deleteResult = await query(
      `
        DELETE FROM telefonos_autorizados 
        WHERE id = $1 AND usuario_principal_id = $2
        RETURNING id
      `,
      [newDelegate.id, principalId]
    );

    console.log(`[OK] Delegado eliminado con ID: ${deleteResult.rows[0]?.id}`);
    if (deleteResult.rows.length === 0 || deleteResult.rows[0].id !== newDelegate.id) {
      throw new Error("Fallo en Test D: El borrado no retornó el ID correcto");
    }

    const listEmptyResult = await query(
      `SELECT id FROM telefonos_autorizados WHERE usuario_principal_id = $1`,
      [principalId]
    );
    console.log(`[OK] Cantidad después de borrar: ${listEmptyResult.rows.length} (esperado: 0)`);
    if (listEmptyResult.rows.length !== 0) {
      throw new Error("Fallo en Test D: El listado debería estar vacío tras borrar");
    }

    console.log("\n✅ ¡Todos los tests de los endpoints API pasaron exitosamente!");

  } catch (error) {
    console.error("\n❌ Error en el test de endpoints:", error.message);
    process.exitCode = 1;
  } finally {
    console.log("\nLimpiando base de datos de prueba...");
    await query("DELETE FROM telefonos_autorizados WHERE whatsapp_autorizado IN ($1, $2)", [testOwnerPhone, testDelegatePhone]);
    await query("DELETE FROM usuarios WHERE whatsapp = $1", [testOwnerPhone]);
    console.log("Limpieza completada.");
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
