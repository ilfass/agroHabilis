require("dotenv").config();
const { pool } = require("../src/config/database");
const { calcularFlete, obtenerFletesUsuario } = require("../src/services/fletes");
const { analizarConvenienciaVentaRaw } = require("../src/services/analisis_venta");
const { query } = require("../src/config/database");

async function run() {
  console.log("== TEST FLETES ==");
  const casos = [
    ["Tandil", "Puerto Rosario", "granos", 90],
    ["Cordoba", "Puerto Rosario", "granos", 90],
    ["Corrientes", "Mercado Liniers", "hacienda", 20],
  ];

  for (const c of casos) {
    const r = await calcularFlete(c[0], c[1], c[2], c[3]);
    console.log(`\n${c[0]} -> ${c[1]} (${c[2]}, ${c[3]} tn)`);
    console.log(JSON.stringify(r, null, 2));
  }

  const u = await query(
    `
      SELECT u.*, p.tipo AS perfil_productivo
      FROM usuarios u
      LEFT JOIN LATERAL (
        SELECT tipo FROM perfil_productivo pp
        WHERE pp.usuario_id = u.id
        ORDER BY id DESC LIMIT 1
      ) p ON true
      WHERE u.activo = true
      ORDER BY u.id ASC
      LIMIT 1
    `
  );

  const usuario = u.rows[0];
  if (usuario) {
    const fletesUsuario = await obtenerFletesUsuario(usuario);
    console.log("\nFletes usuario ejemplo:");
    console.log(JSON.stringify(fletesUsuario, null, 2));

    const analisis = await analizarConvenienciaVentaRaw(usuario, "soja");
    console.log("\n== ANALISIS DE VENTA CON FLETE ==");
    console.log(analisis);
  } else {
    console.log("\nNo hay usuario activo para probar obtenerFletesUsuario y analisis_venta.");
  }
}

run()
  .catch((e) => {
    console.error("Error test-fletes:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
