const cron = require("node-cron");
const { query } = require("../config/database");
const { estaListo, esperarClienteListo, sendMessage } = require("../config/whatsapp");
const { marcarResumenEnviado } = require("../services/resumen");
const { renderTemplate } = require("../templates");
const {
  resolverPlanEfectivo,
  puedeRecibirResumenDiario,
  puedeRecibirResumenSemanal,
} = require("../services/planes");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const obtenerUsuariosObjetivo = async () => {
  const result = await query(
    `
      SELECT id, nombre, whatsapp, provincia, partido, plan, activo, plan_activo_hasta, creado_en
      FROM usuarios
      WHERE activo = true
        AND whatsapp <> 'ahbl:sistema'
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

const fechaAR = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const esLunesOJuevesAR = () => {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "short",
  })
    .format(new Date())
    .toLowerCase();
  return wd === "mon" || wd === "thu";
};

const esDiaSiguienteRegistroAR = (creadoEn) => {
  if (!creadoEn) return false;
  const hoy = new Date(`${fechaAR()}T00:00:00`);
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  const reg = new Date(creadoEn);
  const regAR = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reg);
  const ayerAR = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ayer);
  return regAR === ayerAR;
};

const esperarWhatsappEnviador = async () => {
  const maxEsperaMs = 120_000;
  const intervaloMs = 15_000;
  const inicio = Date.now();

  while (Date.now() - inicio < maxEsperaMs) {
    if (estaListo()) return true;
    try {
      await esperarClienteListo(Math.min(intervaloMs, maxEsperaMs - (Date.now() - inicio)));
      if (estaListo()) return true;
    } catch (_error) {
      // reintenta hasta completar ventana total
    }
    await sleep(intervaloMs);
  }
  return estaListo();
};

const ejecutarEnviadorDiario = async () => {
  const resumen = {
    ok: true,
    usuariosObjetivo: 0,
    generados: 0,
    enviados: 0,
    omitidosYaEnviados: 0,
    abortadoPorWhatsapp: false,
    errores: [],
  };

  const whatsappListo = await esperarWhatsappEnviador();
  if (!whatsappListo) {
    resumen.ok = false;
    resumen.abortadoPorWhatsapp = true;
    resumen.errores.push(
      "WhatsApp no estuvo listo dentro de 2 minutos. Se aborta el envío del día."
    );
    console.error("[Enviador] Abortado: WhatsApp no listo tras 2 minutos.");
    return resumen;
  }

  const usuarios = await obtenerUsuariosObjetivo();
  resumen.usuariosObjetivo = usuarios.length;

  for (const usuario of usuarios) {
    try {
      const planEfectivo = resolverPlanEfectivo({
        plan: usuario.plan,
        planActivoHasta: usuario.plan_activo_hasta,
      });

      if (puedeRecibirResumenDiario(planEfectivo) && (await yaEnviadoHoy(usuario.id))) {
        resumen.omitidosYaEnviados += 1;
        continue;
      }
      if (puedeRecibirResumenSemanal(planEfectivo)) {
        // Gratis: día siguiente del registro + lunes y jueves.
        const tocaPorRegistro = esDiaSiguienteRegistroAR(usuario.creado_en);
        const tocaPorCalendario = esLunesOJuevesAR();
        if (!tocaPorRegistro && !tocaPorCalendario) continue;
        if (await yaEnviadoHoy(usuario.id)) {
          resumen.omitidosYaEnviados += 1;
          continue;
        }
      }

      const generado = await renderTemplate("resumen_diario", usuario);
      resumen.generados += 1;

      await sendMessage(usuario.whatsapp, generado.mensaje);
      if (generado.meta?.resumenId) {
        await marcarResumenEnviado(generado.meta.resumenId);
      }
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
