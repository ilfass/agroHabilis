require("dotenv").config();

const { query, pool } = require("../src/config/database");
const { renderTemplate } = require("../src/templates");
const { parseCultivo } = require("../src/services/analisis_venta");

const obtenerUsuarioPrueba = async () => {
  const u = await query(
    `
      SELECT id, nombre, whatsapp, provincia, partido, lat, lng, plan, plan_activo_hasta, tipo_comercializacion
      FROM usuarios
      WHERE activo = true
      ORDER BY id ASC
      LIMIT 1
    `
  );
  const usuario = u.rows[0];
  if (!usuario) throw new Error("No hay usuarios activos para prueba.");
  const cultivos = await query(
    `
      SELECT cultivo, hectareas, costo_por_ha
      FROM usuario_cultivos
      WHERE usuario_id = $1 AND activo = true
      ORDER BY cultivo
    `,
    [usuario.id]
  );
  return { ...usuario, cultivos: cultivos.rows || [] };
};

const printOut = (titulo, out) => {
  console.log(`\n\n===== ${titulo} =====`);
  console.log("template:", out.template);
  console.log("meta:", JSON.stringify(out.meta || {}, null, 2));
  console.log("fuentes/datos:", Object.keys(out.datos || {}).join(", "));
  console.log("mensaje:\n");
  console.log(String(out.mensaje || "").slice(0, 2500));
};

async function main() {
  const usuario = await obtenerUsuarioPrueba();
  const cultivo = parseCultivo(usuario.cultivos?.[0]?.cultivo || "soja");

  const bienvenida = await renderTemplate("bienvenida", usuario, { enviar: false });
  printOut("BIENVENIDA", bienvenida);

  const diario = await renderTemplate("resumen_diario", usuario);
  printOut("RESUMEN_DIARIO", diario);

  const miResumen = await renderTemplate("mi_resumen", usuario);
  printOut("MI_RESUMEN", miResumen);

  const alerta = await renderTemplate("alerta", usuario, {
    cultivo,
    tipo: "precio_sube",
    valor_objetivo: 300000,
  });
  printOut("ALERTA", alerta);

  const analisis = await renderTemplate("analisis_venta", usuario, cultivo);
  printOut("ANALISIS_VENTA", analisis);

  const consulta = await renderTemplate(
    "consulta",
    usuario,
    `¿Conviene vender ${cultivo} esta semana con este dólar?`
  );
  printOut("CONSULTA", consulta);
}

main()
  .catch((e) => {
    console.error("Error test-templates:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
