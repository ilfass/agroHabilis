const cron = require("node-cron");
const { query } = require("../config/database");
const { sendMessage } = require("../config/whatsapp");
const { generarResumen, marcarResumenEnviado } = require("../services/resumen");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const obtenerUsuariosObjetivo = async () => {
  const result = await query(
    `
      SELECT id, nombre, whatsapp, provincia, partido, plan, activo, plan_activo_hasta
      FROM usuarios
      WHERE activo = true
        AND whatsapp <> 'ahbl:sistema'
        AND (
          COALESCE(plan, 'gratis') <> 'gratis'
          OR (plan_activo_hasta IS NOT NULL AND plan_activo_hasta >= NOW())
        )
      ORDER BY id
    `
  );
  return result.rows;
};

const yaEnviadoHoy = async (usuarioId) => {
  const result = await query(
    `
      SELECT 1
      FROM resumenes
      WHERE usuario_id = $1
        AND fecha = CURRENT_DATE
        AND enviado_wp = true
      LIMIT 1
    `,
    [usuarioId]
  );
  return Boolean(result.rows[0]);
};

const ejecutarEnviadorDiario = async () => {
  const resumen = {
    ok: true,
    usuariosObjetivo: 0,
    generados: 0,
    enviados: 0,
    omitidosYaEnviados: 0,
    errores: [],
  };

  const usuarios = await obtenerUsuariosObjetivo();
  resumen.usuariosObjetivo = usuarios.length;

  for (const usuario of usuarios) {
    try {
      if (await yaEnviadoHoy(usuario.id)) {
        resumen.omitidosYaEnviados += 1;
        continue;
      }

      const generado = await generarResumen(usuario.id);
      resumen.generados += 1;

      await sendMessage(usuario.whatsapp, generado.texto);
      await marcarResumenEnviado(generado.resumenId);
      resumen.enviados += 1;

      await sleep(2000);
    } catch (error) {
      resumen.ok = false;
      resumen.errores.push(
        `Usuario ${usuario.id} (${usuario.whatsapp}): ${error.message}`
      );
    }
  }

  console.log("[Enviador] Resultado:", JSON.stringify(resumen, null, 2));
  if (resumen.errores.length) {
    console.error("[Enviador] Errores:", resumen.errores);
  }
  return resumen;
};

const iniciarCronEnviador = () => {
  const tz = "America/Argentina/Buenos_Aires";
  cron.schedule(
    "0 8 * * 1-5",
    async () => {
      try {
        await ejecutarEnviadorDiario();
      } catch (error) {
        console.error("[Enviador] Error inesperado en cron:", error.message);
      }
    },
    { timezone: tz }
  );
  console.log("Cron job de envío activado - corre L-V a las 8am");
};

module.exports = {
  ejecutarEnviadorDiario,
  iniciarCronEnviador,
};
