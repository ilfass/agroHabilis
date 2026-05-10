require("dotenv").config();

const { query, pool } = require("../../src/config/database");
const { procesarConsulta } = require("../../src/services/consultas");
const { generarResumen } = require("../../src/services/resumen");
const { configurarAlerta, verificarAlertas } = require("../../src/services/alertas");

const USUARIOS = [
  // Agricultura: sur/centro/norte
  {
    key: "agri_sur",
    nombre: "Juan Sur Agricola",
    whatsapp: "5491100020001",
    provincia: "Buenos Aires",
    partido: "Tandil",
    perfil: "agricultura",
    plan: "gratis",
    cultivos: ["Soja", "Trigo"],
    hectareas: 320,
    costo: 460,
  },
  {
    key: "agri_centro",
    nombre: "Carlos Centro Agricola",
    whatsapp: "5491100020002",
    provincia: "Santa Fe",
    partido: "Rafaela",
    perfil: "agricultura",
    plan: "basico",
    cultivos: ["Maiz", "Soja"],
    hectareas: 410,
    costo: 430,
  },
  {
    key: "agri_norte",
    nombre: "Luis Norte Agricola",
    whatsapp: "5491100020003",
    provincia: "Chaco",
    partido: "Presidencia Roque Saenz Peña",
    perfil: "agricultura",
    plan: "pro",
    cultivos: ["Girasol", "Soja"],
    hectareas: 280,
    costo: 390,
  },
  // Ganaderia: sur/centro/norte
  {
    key: "gan_sur",
    nombre: "Marta Sur Ganadera",
    whatsapp: "5491100020004",
    provincia: "Rio Negro",
    partido: "General Roca",
    perfil: "ganaderia",
    plan: "basico",
    cultivos: [],
    hectareas: 0,
    costo: 0,
    stock: [
      { categoria: "vacas", cantidad: 110 },
      { categoria: "terneros", cantidad: 75 },
    ],
  },
  {
    key: "gan_centro",
    nombre: "Pedro Centro Ganadero",
    whatsapp: "5491100020005",
    provincia: "Cordoba",
    partido: "Rio Cuarto",
    perfil: "ganaderia",
    plan: "pro",
    cultivos: [],
    hectareas: 0,
    costo: 0,
    stock: [
      { categoria: "novillos", cantidad: 92 },
      { categoria: "vacas", cantidad: 66 },
    ],
  },
  {
    key: "gan_norte",
    nombre: "Ana Norte Ganadera",
    whatsapp: "5491100020006",
    provincia: "Salta",
    partido: "Metan",
    perfil: "ganaderia",
    plan: "gratis",
    cultivos: [],
    hectareas: 0,
    costo: 0,
    stock: [
      { categoria: "vacas", cantidad: 95 },
      { categoria: "terneros", cantidad: 84 },
    ],
  },
];

const upsertUsuario = async (u) => {
  const r = await query(
    `
      INSERT INTO usuarios (nombre, whatsapp, provincia, partido, plan, activo)
      VALUES ($1,$2,$3,$4,$5,true)
      ON CONFLICT (whatsapp) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        provincia = EXCLUDED.provincia,
        partido = EXCLUDED.partido,
        plan = EXCLUDED.plan,
        activo = true
      RETURNING id, nombre, whatsapp, plan
    `,
    [u.nombre, u.whatsapp, u.provincia, u.partido, u.plan]
  );
  return r.rows[0];
};

const setPerfilYCultivos = async (usuarioId, u) => {
  await query("UPDATE perfil_productivo SET activo=false WHERE usuario_id=$1", [usuarioId]);
  await query(
    `
      INSERT INTO perfil_productivo (usuario_id, tipo, activo)
      VALUES ($1, $2, true)
    `,
    [usuarioId, u.perfil]
  );

  await query("DELETE FROM usuario_cultivos WHERE usuario_id = $1", [usuarioId]);
  for (const cultivo of u.cultivos || []) {
    await query(
      `
        INSERT INTO usuario_cultivos (usuario_id, cultivo, hectareas, costo_por_ha, activo)
        VALUES ($1, $2, $3, $4, true)
      `,
      [usuarioId, cultivo, u.hectareas || null, u.costo || null]
    );
  }

  if (u.perfil === "ganaderia") {
    await query(
      "DELETE FROM stock_ganadero WHERE usuario_id = $1 AND fecha = CURRENT_DATE",
      [usuarioId]
    );
    for (const s of u.stock || []) {
      await query(
        `
          INSERT INTO stock_ganadero (usuario_id, categoria, cantidad, fecha)
          VALUES ($1,$2,$3,CURRENT_DATE)
        `,
        [usuarioId, s.categoria, s.cantidad]
      );
    }
  }
};

const main = async () => {
  try {
    const users = {};
    for (const u of USUARIOS) {
      const dbUser = await upsertUsuario(u);
      users[u.key] = dbUser;
      await setPerfilYCultivos(dbUser.id, u);
    }

    // Consultas reales por plan/perfil.
    await procesarConsulta(users.agri_sur.whatsapp, "¿Cuánto está la soja hoy?");
    await procesarConsulta(users.agri_centro.whatsapp, "¿Me conviene vender maíz ahora o esperar?");
    await procesarConsulta(users.agri_norte.whatsapp, "¿Cómo viene el clima para esta semana?");
    await procesarConsulta(users.gan_sur.whatsapp, "¿Cómo está el tipo de cambio hoy?");
    await procesarConsulta(users.gan_centro.whatsapp, "¿Cómo está el mercado para decidir ventas?");
    await procesarConsulta(users.gan_norte.whatsapp, "Dame un resumen de precios y clima");

    // Resúmenes reales por perfil+region.
    for (const k of Object.keys(users)) {
      await generarResumen(users[k].id);
    }

    // Alerta real y disparo simulado (sin envío WA).
    await configurarAlerta(users.agri_centro.whatsapp, "AVISAME cuando la soja supere 1");
    await verificarAlertas({ soloSimularEnvio: true });

    const r = await query(
      `
        SELECT
          (SELECT COUNT(*) FROM historial_consultas WHERE usuario_id = ANY($1::int[]))::int AS consultas_seed,
          (SELECT COUNT(*) FROM resumenes WHERE usuario_id = ANY($1::int[]))::int AS resumenes_seed,
          (SELECT COUNT(*) FROM alertas WHERE usuario_id = ANY($1::int[]))::int AS alertas_seed
      `,
      [Object.values(users).map((x) => x.id)]
    );

    console.log("Seed casos reales OK:", r.rows[0]);
  } catch (error) {
    console.error("Error seed-casos-reales:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
};

main();
