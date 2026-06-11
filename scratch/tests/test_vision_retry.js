require("dotenv").config();
const { query, pool, testConnection } = require("../src/config/database");

async function run() {
  try {
    await testConnection();
    
    // 1. Obtener un usuario de prueba
    const uRes = await query("SELECT id, whatsapp FROM usuarios LIMIT 1");
    if (uRes.rows.length === 0) {
      console.error("No hay usuarios en la base de datos para probar!");
      return;
    }
    const user = uRes.rows[0];
    console.log(`Usuario seleccionado para pruebas: ID=${user.id}, WhatsApp=${user.whatsapp}`);

    // 2. Insertar elemento ficticio en vision_retry_queue
    const dummyBuffer = Buffer.from("dummy-image-bytes");
    const insertRes = await query(`
      INSERT INTO vision_retry_queue (usuario_id, whatsapp_norm, media_buffer, mime_type, error_mensaje)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [user.id, user.whatsapp, dummyBuffer, "image/png", "Error ficticio de cuota 429"]);
    const queuedId = insertRes.rows[0].id;
    console.log(`Insertado elemento en cola de reintentos con ID: ${queuedId}`);

    // 3. Consultar la cola
    const selectRes = await query("SELECT id, usuario_id, whatsapp_norm, mime_type, creado_en FROM vision_retry_queue");
    console.log("Elementos actualmente en la cola:", selectRes.rows);

    // 4. Limpiar elemento
    console.log("Limpiando elemento de prueba...");
    await query("DELETE FROM vision_retry_queue WHERE id = $1", [queuedId]);
    console.log("Prueba exitosa!");

  } catch (error) {
    console.error("Error en pruebas:", error);
  } finally {
    await pool.end();
  }
}

run();
