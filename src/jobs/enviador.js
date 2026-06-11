const cron = require("node-cron");
const { query } = require("../config/database");
const { estaListo, esperarClienteListo, sendMessage } = require("../config/whatsapp");
const {
  resolverPlanEfectivo,
  puedeRecibirResumenSemanal,
} = require("../services/planes");
const { iniciarResumen } = require("../services/resumen_interactivo");
const { invitacionResumenInteractivoHoy } = require("../services/conversacion_estado");
const { destinoWhatsappParaEnvio } = require("../models/usuario");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Cron masivo L–V (`iniciarCronEnviador`). Por defecto: desactivado. Activar explícitamente: `ENVIADOR_RESUMEN_DIARIO=1|true|on`. */
const enviadorResumenDiarioCronHabilitado = () => {
  const v = String(process.env.ENVIADOR_RESUMEN_DIARIO || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true;
  return false;
};

const obtenerUsuariosObjetivo = async () => {
  const result = await query(
    `
      SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, plan, activo, plan_activo_hasta, creado_en
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
        AND fecha = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
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

const fechaARDe = (value) => {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
};

const restarDiasFechaIso = (fechaIso, dias) => {
  if (!fechaIso) return null;
  const [y, m, d] = String(fechaIso).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - dias);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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
  const regAR = fechaARDe(creadoEn);
  const ayerAR = restarDiasFechaIso(fechaAR(), 1);
  return Boolean(regAR && ayerAR && regAR === ayerAR);
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
    omitidosOnboardingPendiente: 0,
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

      // Cron masivo: solo Básico (cada día hábil) y Gratis (lun/jue o día post-registro). Pro: solo MI RESUMEN / admin.
      if (planEfectivo === "basico") {
        if (await yaEnviadoHoy(usuario.id)) {
          resumen.omitidosYaEnviados += 1;
          continue;
        }
        if (await invitacionResumenInteractivoHoy(usuario.id)) {
          resumen.omitidosYaEnviados += 1;
          continue;
        }
      } else if (puedeRecibirResumenSemanal(planEfectivo)) {
        const tocaPorRegistro = esDiaSiguienteRegistroAR(usuario.creado_en);
        const tocaPorCalendario = esLunesOJuevesAR();
        if (!tocaPorRegistro && !tocaPorCalendario) continue;
        if (await yaEnviadoHoy(usuario.id)) {
          resumen.omitidosYaEnviados += 1;
          continue;
        }
        if (await invitacionResumenInteractivoHoy(usuario.id)) {
          resumen.omitidosYaEnviados += 1;
          continue;
        }
      } else {
        continue;
      }

      const destinoWp = destinoWhatsappParaEnvio(usuario);
      const outInv = await iniciarResumen(usuario, {
        enviar: (texto) => sendMessage(destinoWp, texto),
      });
      if (outInv?.omitido) {
        resumen.omitidosOnboardingPendiente += 1;
      } else {
        resumen.generados += 1;
        resumen.enviados += 1;
      }

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
  if (!enviadorResumenDiarioCronHabilitado()) {
    console.log(
      "[Enviador] Cron de resumen masivo desactivado por defecto. Habilitalo explícitamente seteando ENVIADOR_RESUMEN_DIARIO=1|true|on."
    );
    return;
  }
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
