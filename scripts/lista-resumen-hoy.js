#!/usr/bin/env node
/**
 * Lista usuarios activos: a quién le llegó algo del resumen hoy (Argentina)
 * vs quién no, y opcionalmente quién entraba en el criterio del cron pero no tiene marca ni resumen enviado.
 *
 * Uso: node scripts/lista-resumen-hoy.js
 */
require("dotenv").config();
const { query, pool } = require("../src/config/database");
const {
  resolverPlanEfectivo,
  puedeRecibirResumenSemanal,
} = require("../src/services/planes");
const { invitacionResumenInteractivoHoy } = require("../src/services/conversacion_estado");

const TZ = "America/Argentina/Buenos_Aires";

const fechaAR = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
};

const fechaARDe = (value) => {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${m.year}-${m.month}-${m.day}`;
};

const restarDiasFechaIso = (fechaIso, dias) => {
  if (!fechaIso) return null;
  const [y, M, d] = String(fechaIso).split("-").map(Number);
  const t = new Date(Date.UTC(y, M - 1, d));
  t.setUTCDate(t.getUTCDate() - dias);
  const yy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

const esLunesOJuevesAR = () => {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
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

const yaEnviadoResumenWpHoy = async (usuarioId) => {
  const r = await query(
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
  return Boolean(r.rows[0]);
};

/**
 * Misma lógica que el bucle de enviador.js antes de llamar a iniciarResumen:
 * si devuelve true, ese día el cron intentaría mandar la invitación (L-V 8am asumiendo que el cron corre).
 */
const cronIntentariaEnviarHoy = async (usuario) => {
  const planEfectivo = resolverPlanEfectivo({
    plan: usuario.plan,
    planActivoHasta: usuario.plan_activo_hasta,
  });

  if (planEfectivo === "basico") {
    if (await yaEnviadoResumenWpHoy(usuario.id)) return false;
    if (await invitacionResumenInteractivoHoy(usuario.id)) return false;
    return true;
  }

  if (puedeRecibirResumenSemanal(planEfectivo)) {
    const tocaPorRegistro = esDiaSiguienteRegistroAR(usuario.creado_en);
    const tocaPorCalendario = esLunesOJuevesAR();
    if (!tocaPorRegistro && !tocaPorCalendario) return false;
    if (await yaEnviadoResumenWpHoy(usuario.id)) return false;
    if (await invitacionResumenInteractivoHoy(usuario.id)) return false;
    return true;
  }

  return false;
};

const fmt = (u, extra = "") =>
  `  id=${u.id}  ${String(u.nombre || "").slice(0, 36)}  wa=${u.whatsapp}  plan=${u.plan}${extra ? `  ${extra}` : ""}`;

const main = async () => {
  const hoy = fechaAR();
  const wd = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long" }).format(new Date());

  const { rows: usuarios } = await query(`
    SELECT id, nombre, whatsapp, plan, plan_activo_hasta, creado_en, ultima_invitacion_resumen_interactivo
    FROM usuarios
    WHERE activo = true AND whatsapp <> 'ahbl:sistema'
    ORDER BY id
  `);

  const llegaron = [];
  const noLlegaron = [];
  const debianCronSinRastro = [];

  for (const u of usuarios) {
    const fechaInv = u.ultima_invitacion_resumen_interactivo
      ? fechaARDe(u.ultima_invitacion_resumen_interactivo)
      : null;
    const invitacionHoy = fechaInv === hoy;
    const resumenWpHoy = await yaEnviadoResumenWpHoy(u.id);

    const detalles = [];
    if (invitacionHoy) detalles.push("invitación_hoy");
    if (resumenWpHoy) detalles.push("resumen_wp_enviado_hoy");

    if (invitacionHoy || resumenWpHoy) {
      llegaron.push({ u, detalles: detalles.join("+") || "?" });
    } else {
      noLlegaron.push(u);
    }

    const intentaria = await cronIntentariaEnviarHoy(u);
    if (intentaria && !invitacionHoy && !resumenWpHoy) {
      debianCronSinRastro.push(u);
    }
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log(`Fecha Argentina: ${hoy} (${wd})`);
  console.log(`Usuarios activos (excl. sistema): ${usuarios.length}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  console.log(`✅ LES LLEGÓ ALGO HOY (${llegaron.length}) — invitación interactiva y/o resumen marcado enviado_wp`);
  console.log("   (invitación = columna ultima_invitacion_resumen_interactivo = hoy)\n");
  for (const { u, detalles } of llegaron) {
    console.log(fmt(u, `[${detalles}]`));
  }

  console.log(`\n⬜ SIN ENVÍO / INVITACIÓN HOY (${noLlegaron.length})`);
  for (const u of noLlegaron) {
    const pe = resolverPlanEfectivo({ plan: u.plan, planActivoHasta: u.plan_activo_hasta });
    const gratis = pe === "gratis";
    const extra = gratis
      ? `plan_efectivo=${pe} (gratis: solo lun/jue o día post-registro)`
      : `plan_efectivo=${pe}`;
    console.log(fmt(u, extra));
  }

  console.log(
    `\n⚠️  CRON HUBIERA INTENTADO ENVIAR PERO NO HAY MARCA NI resumen enviado_wp HOY (${debianCronSinRastro.length})`
  );
  console.log("   (útil para detectar fallos de WhatsApp o lógica; el cron solo corre L-V 8:00 AR.)\n");
  for (const u of debianCronSinRastro) {
    console.log(fmt(u));
  }

  await pool.end();
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  pool.end().catch(() => {});
});
