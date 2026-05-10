const { query } = require("../config/database");
const { buscarPorWhatsapp } = require("../models/usuario");

const normalizarPlan = (plan) => {
  const p = String(plan || "gratis")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  if (p === "pro") return "pro";
  if (p === "basico" || p === "básico" || p === "basic") return "basico";
  return "gratis";
};

const resolverPlanEfectivo = ({ plan, planActivoHasta }) => {
  const base = normalizarPlan(plan);
  if (base !== "gratis") return base;
  if (planActivoHasta && new Date(planActivoHasta).getTime() >= Date.now()) {
    // Si tiene ventana activa sin plan pago explícito, tratamos como básico (trial).
    return "basico";
  }
  return "gratis";
};

const obtenerContextoPlanPorWhatsapp = async (whatsapp) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return { usuario: null, plan: "gratis", planEfectivo: "gratis" };
  const r = await query(
    `
      SELECT plan, plan_activo_hasta
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuario.id]
  );
  const plan = normalizarPlan(r.rows[0]?.plan || usuario.plan);
  const planActivoHasta = r.rows[0]?.plan_activo_hasta || null;
  return {
    usuario,
    plan,
    planActivoHasta,
    planEfectivo: resolverPlanEfectivo({ plan, planActivoHasta }),
  };
};

const actualizarPlanPorWhatsapp = async ({ whatsapp, plan }) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario) return null;
  const planNormalizado = normalizarPlan(plan);
  const r = await query(
    `
      UPDATE usuarios
      SET plan = $2, plan_activo_hasta = NULL
      WHERE id = $1
      RETURNING id, nombre, whatsapp, plan, plan_activo_hasta, activo
    `,
    [usuario.id, planNormalizado]
  );
  return r.rows[0] || null;
};

const obtenerLimiteConsultasMensual = (planEfectivo) => {
  if (planEfectivo === "gratis") return 20;
  return null;
};

const validarCupoConsultasMensual = async ({ usuarioId, planEfectivo }) => {
  const limite = obtenerLimiteConsultasMensual(planEfectivo);
  if (!usuarioId || !limite) return { ok: true, usadas: 0, limite };
  const r = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM historial_consultas
      WHERE usuario_id = $1
        AND date_trunc('month', creado_en) = date_trunc('month', NOW())
    `,
    [usuarioId]
  );
  const usadas = Number(r.rows[0]?.total || 0);
  return { ok: usadas < limite, usadas, limite };
};

const puedeUsarAlertas = (planEfectivo) => planEfectivo === "basico" || planEfectivo === "pro";
const puedeUsarFinanzas = (planEfectivo) => planEfectivo === "pro";
const puedeRecibirResumenDiario = (planEfectivo) =>
  planEfectivo === "basico" || planEfectivo === "pro";
const puedeRecibirResumenSemanal = (planEfectivo) => planEfectivo === "gratis";

module.exports = {
  normalizarPlan,
  resolverPlanEfectivo,
  obtenerContextoPlanPorWhatsapp,
  actualizarPlanPorWhatsapp,
  obtenerLimiteConsultasMensual,
  validarCupoConsultasMensual,
  puedeUsarAlertas,
  puedeUsarFinanzas,
  puedeRecibirResumenDiario,
  puedeRecibirResumenSemanal,
};
