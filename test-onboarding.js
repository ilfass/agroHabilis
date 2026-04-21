require("dotenv").config();

const { pool, query } = require("./src/config/database");
const { gestionarOnboarding } = require("./src/services/onboarding");
const { obtenerPerfil } = require("./src/models/usuario");

const numeroPrueba = `54911${Date.now().toString().slice(-8)}`;

const mensajes = [
  "Fabian Prueba",
  "Buenos Aires",
  "General Pueyrredon",
  "soja, maíz, trigo",
  "320",
  "450",
];

const main = async () => {
  try {
    console.log("Numero de prueba:", numeroPrueba);
    const inicio = await gestionarOnboarding(numeroPrueba, "hola");
    console.log("\nBot:", inicio.respuesta);

    for (const msg of mensajes) {
      const step = await gestionarOnboarding(numeroPrueba, msg);
      console.log(`\nUsuario: ${msg}`);
      console.log(`Bot: ${step.respuesta}`);
    }

    const perfil = await obtenerPerfil(numeroPrueba);
    console.log("\n=== PERFIL CREADO ===");
    console.log(JSON.stringify(perfil, null, 2));

    const sql = await query(
      `
        SELECT u.id, u.nombre, u.whatsapp, u.provincia, u.partido, uc.cultivo, uc.hectareas, uc.costo_por_ha
        FROM usuarios u
        LEFT JOIN usuario_cultivos uc ON uc.usuario_id = u.id AND uc.activo = true
        WHERE regexp_replace(u.whatsapp, '\\D', '', 'g') = $1
        ORDER BY uc.cultivo
      `,
      [numeroPrueba]
    );

    console.log("\n=== SELECT USUARIO + CULTIVOS ===");
    console.log(JSON.stringify(sql.rows, null, 2));
  } catch (error) {
    console.error("Error en test-onboarding:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

main();
