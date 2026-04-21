require("dotenv").config();

const { pool, query } = require("./src/config/database");
const { gestionarOnboarding } = require("./src/services/onboarding");
const {
  registrarGasto,
  registrarVenta,
  obtenerResumenFinanciero,
} = require("./src/services/gastos");
const { buscarPorWhatsapp } = require("./src/models/usuario");
const { generarResumen } = require("./src/services/resumen");

const WP_AGRI = "5491100001001";
const WP_GAN = "5491100001002";

const simularOnboarding = async (whatsapp, respuestas) => {
  const transcript = [];
  for (const msg of respuestas) {
    const r = await gestionarOnboarding(whatsapp, msg);
    transcript.push({ msg, respuesta: r.respuesta, enOnboarding: r.enOnboarding });
  }
  return transcript;
};

const main = async () => {
  try {
    await query("DELETE FROM onboarding_estado WHERE whatsapp = ANY($1::text[])", [[WP_AGRI, WP_GAN]]);
    await query("DELETE FROM usuarios WHERE whatsapp = ANY($1::text[])", [[WP_AGRI, WP_GAN]]);

    const flujoAgri = await simularOnboarding(WP_AGRI, [
      "hola",
      "Pedro Agricultor",
      "Buenos Aires",
      "Pergamino",
      "soja, maiz",
      "350",
      "520",
      "1",
    ]);

    const flujoGan = await simularOnboarding(WP_GAN, [
      "hola",
      "Marta Ganadera",
      "Santa Fe",
      "Rafaela",
      "ninguno",
      "0",
      "0",
      "2",
      "180",
      "vacas, terneros, novillos",
    ]);

    const g1 = await registrarGasto(WP_AGRI, "gasté 2500000 en glifosato para el lote norte");
    const g2 = await registrarGasto(WP_AGRI, "compré semilla de soja por 800000");
    const g3 = await registrarGasto(WP_GAN, "vacuna aftosa 180000 para 150 animales");
    const v1 = await registrarVenta(WP_AGRI, "vendí 100 toneladas de soja a 430000");

    const usuarioAgri = await buscarPorWhatsapp(WP_AGRI);
    const usuarioGan = await buscarPorWhatsapp(WP_GAN);

    const resumenFinAgri = await obtenerResumenFinanciero(usuarioAgri.id);
    const resumenFinGan = await obtenerResumenFinanciero(usuarioGan.id);

    const resumenDiarioAgri = await generarResumen(usuarioAgri.id);
    const resumenDiarioGan = await generarResumen(usuarioGan.id);

    const gastosParseados = await query(
      `
        SELECT usuario_id, perfil, categoria, descripcion, monto, fecha
        FROM gastos
        WHERE usuario_id = ANY($1::int[])
        ORDER BY id DESC
        LIMIT 10
      `,
      [[usuarioAgri.id, usuarioGan.id]]
    );

    console.log("\n=== ONBOARDING AGRICOLA ===");
    console.log(JSON.stringify(flujoAgri, null, 2));
    console.log("\n=== ONBOARDING GANADERO ===");
    console.log(JSON.stringify(flujoGan, null, 2));

    console.log("\n=== RESPUESTAS REGISTRO GASTOS/VENTA ===");
    console.log({ g1, g2, g3, v1 });

    console.log("\n=== GASTOS PARSEADOS (DB) ===");
    console.log(JSON.stringify(gastosParseados.rows, null, 2));

    console.log("\n=== RESUMEN FINANCIERO AGRICOLA ===");
    console.log(JSON.stringify(resumenFinAgri, null, 2));
    console.log("\n=== RESUMEN FINANCIERO GANADERO ===");
    console.log(JSON.stringify(resumenFinGan, null, 2));

    console.log("\n=== RESUMEN DIARIO AGRICOLA ===");
    console.log(resumenDiarioAgri.texto);
    console.log("\n=== RESUMEN DIARIO GANADERO ===");
    console.log(resumenDiarioGan.texto);
  } catch (error) {
    console.error("Error test-perfiles:", error.message);
    if (error.detail) console.error("Detalle:", error.detail);
    if (error.where) console.error("Where:", error.where);
    if (error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

main();
