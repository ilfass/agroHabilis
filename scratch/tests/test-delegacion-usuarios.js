require("dotenv").config();
const { query, pool } = require("../src/config/database");
const { buscarPorWhatsapp } = require("../src/models/usuario");

async function main() {
  console.log("==> Iniciando test de Delegación Multiusuario...");
  
  // 1. Limpieza preventiva
  await query("DELETE FROM telefonos_autorizados WHERE whatsapp_autorizado = '549249111222'");
  await query("DELETE FROM usuarios WHERE whatsapp = '549249333444'");
  
  try {
    // 2. Crear usuario principal (Dueño)
    const resPrincipal = await query(`
      INSERT INTO usuarios (nombre, whatsapp, plan, activo)
      VALUES ('Juan Gomez (Dueño)', '549249333444', 'pro', true)
      RETURNING id
    `);
    const principalId = resPrincipal.rows[0].id;
    console.log(`[OK] Usuario Principal (Dueño) creado con ID: ${principalId}`);
    
    // 3. Crear teléfono autorizado (Empleado)
    await query(`
      INSERT INTO telefonos_autorizados (usuario_principal_id, whatsapp_autorizado, nombre_contacto, rol, activo)
      VALUES ($1, '549249111222', 'Pedro Ramirez (Encargado)', 'encargado', true)
    `, [principalId]);
    console.log("[OK] Teléfono Autorizado (Pedro Ramirez - Encargado) enlazado al Dueño");
    
    // 4. Test 1: Buscar por número del Dueño
    const testOwner = await buscarPorWhatsapp("549249333444");
    console.log("\n--- Test 1: Buscar Dueño ---");
    if (testOwner) {
      console.log(`[OK] Usuario encontrado: ${testOwner.nombre}`);
      console.log(`     es_delegado: ${testOwner.es_delegado} (esperado: false)`);
      console.log(`     nombre_operario: ${testOwner.nombre_operario} (esperado: Juan Gomez (Dueño))`);
      console.log(`     rol_operario: ${testOwner.rol_operario} (esperado: dueño)`);
      
      if (testOwner.es_delegado !== false || testOwner.rol_operario !== 'dueño') {
        throw new Error("Fallo en Test 1: Propiedades incorrectas");
      }
    } else {
      throw new Error("Fallo en Test 1: No se encontró al Dueño");
    }

    // 5. Test 2: Buscar por número del Encargado (Delegado)
    const testDelegate = await buscarPorWhatsapp("549249111222");
    console.log("\n--- Test 2: Buscar Encargado (Delegado) ---");
    if (testDelegate) {
      console.log(`[OK] Usuario principal resuelto: ${testDelegate.nombre}`);
      console.log(`     id_principal: ${testDelegate.id} (esperado: ${principalId})`);
      console.log(`     es_delegado: ${testDelegate.es_delegado} (esperado: true)`);
      console.log(`     nombre_operario: ${testDelegate.nombre_operario} (esperado: Pedro Ramirez (Encargado))`);
      console.log(`     rol_operario: ${testDelegate.rol_operario} (esperado: encargado)`);
      
      if (testDelegate.id !== principalId || testDelegate.es_delegado !== true || testDelegate.rol_operario !== 'encargado') {
        throw new Error("Fallo en Test 2: Mapeo o propiedades incorrectas");
      }
    } else {
      throw new Error("Fallo en Test 2: No se resolvió al Encargado");
    }
    
    console.log("\n✅ ¡Todos los tests pasaron exitosamente!");

  } catch (error) {
    console.error("\n❌ Error en el test:", error.message);
    process.exitCode = 1;
  } finally {
    // 6. Limpieza final de datos de prueba
    console.log("\nLimpiando base de datos...");
    await query("DELETE FROM telefonos_autorizados WHERE whatsapp_autorizado = '549249111222'");
    await query("DELETE FROM usuarios WHERE whatsapp = '549249333444'");
    console.log("Limpieza completada.");
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
