const { query } = require("../config/database");
const { buscarPorWhatsapp } = require("../models/usuario");

const normalizarPlan = (plan) => {
  const p = String(plan || "gratis")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (p === "pro_max" || p === "promax" || p === "pro-max" || p === "pro_ma") return "pro_max";
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

const obtenerContextoPlanPorWhatsapp = async (whatsapp, numeroReal) => {
  const usuario = await buscarPorWhatsapp(whatsapp, numeroReal);
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

  // Los delegados (integrantes de equipo) operan bajo los límites individuales del Plan Gratis
  const esDelegado = Boolean(usuario.es_delegado);
  const planEfectivo = esDelegado
    ? "gratis"
    : resolverPlanEfectivo({ plan, planActivoHasta });

  return {
    usuario,
    plan: esDelegado ? "gratis" : plan,
    planActivoHasta: esDelegado ? null : planActivoHasta,
    planEfectivo,
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

const PLAN_PRICES_CACHE = {
  gratis: 0,
  basico: 22000,
  pro: 29000,
  pro_max: 50000
};

const inicializarPreciosPlanes = async () => {
  try {
    const r = await query("SELECT plan_nombre, precio FROM planes_config");
    for (const row of r.rows) {
      const pName = normalizarPlan(row.plan_nombre);
      PLAN_PRICES_CACHE[pName] = Number(row.precio);
    }
  } catch (e) {
    // Fallback silencioso en caso de tabla ausente o error temporal
  }
};

// Disparar carga inicial asíncrona
inicializarPreciosPlanes().catch(() => {});

const actualizarPrecioCache = (plan, precio) => {
  const norm = normalizarPlan(plan);
  PLAN_PRICES_CACHE[norm] = Number(precio);
};

/**
 * Obtener configuración de límites dinámicos desde la tabla planes_config.
 * Si falla, retorna fallbacks estáticos alineados con las especificaciones.
 */
const obtenerConfigPlan = async (planEfectivo) => {
  const norm = normalizarPlan(planEfectivo);
  try {
    const r = await query(
      `SELECT precio, limite_audios_semanal, limite_fotos_semanal, limite_consultas_semanal
       FROM planes_config
       WHERE plan_nombre = $1
       LIMIT 1`,
      [norm]
    );
    if (r.rows[0]) {
      const precio = Number(r.rows[0].precio);
      PLAN_PRICES_CACHE[norm] = precio;
      return {
        plan: norm,
        precio,
        limite_audios_semanal: Number(r.rows[0].limite_audios_semanal),
        limite_fotos_semanal: Number(r.rows[0].limite_fotos_semanal),
        limite_consultas_semanal: Number(r.rows[0].limite_consultas_semanal)
      };
    }
  } catch (e) {
    console.error("[planes] Error cargando config plan de DB:", e.message);
  }
  // Fallbacks estáticos
  const fallbacks = {
    gratis: { precio: 0, limite_audios_semanal: 4, limite_fotos_semanal: 2, limite_consultas_semanal: 25 },
    basico: { precio: 22000, limite_audios_semanal: 40, limite_fotos_semanal: 15, limite_consultas_semanal: 200 },
    pro: { precio: 29000, limite_audios_semanal: 60, limite_fotos_semanal: 22, limite_consultas_semanal: 450 },
    pro_max: { precio: 50000, limite_audios_semanal: -1, limite_fotos_semanal: -1, limite_consultas_semanal: -1 }
  };
  return { plan: norm, ...(fallbacks[norm] || fallbacks.gratis) };
};

/**
 * Valida los límites semanales para un usuario en base a su plan efectivo.
 */
const validarLimitesSemanales = async ({ usuarioId, planEfectivo, esAudio, esFoto }) => {
  if (!usuarioId) return { ok: true, mensaje: null };

  const config = await obtenerConfigPlan(planEfectivo);

  // Obtener consumos de la semana actual (desde el lunes)
  const r = await query(
    `
      SELECT
        COUNT(*) FILTER (WHERE pregunta LIKE '%[Audio transcrito:%') AS audios_usados,
        COUNT(*) FILTER (WHERE pregunta LIKE '%[Análisis de archivo:%') AS fotos_usadas,
        COUNT(*) AS consultas_usadas
      FROM historial_consultas
      WHERE usuario_id = $1
        AND creado_en >= date_trunc('week', NOW())
    `,
    [usuarioId]
  );

  const audiosUsados = Number(r.rows[0]?.audios_usados || 0);
  const fotosUsadas = Number(r.rows[0]?.fotos_usadas || 0);
  const consultasUsadas = Number(r.rows[0]?.consultas_usadas || 0);

  const planLabel = config.plan === "pro_max" ? "Pro Max" : config.plan === "pro" ? "Pro" : config.plan === "basico" ? "Básico" : "Gratis";

  // Validar audio
  if (esAudio && config.limite_audios_semanal !== -1 && audiosUsados >= config.limite_audios_semanal) {
    return {
      ok: false,
      razon: "limite_audios",
      usadas: audiosUsados,
      limite: config.limite_audios_semanal,
      mensaje: `Alcanzaste tu límite semanal de ${config.limite_audios_semanal} mensajes de audio en tu Plan ${planLabel}. Pasate a un plan superior para seguir mandando audios.`,
    };
  }

  // Validar fotos
  if (esFoto && config.limite_fotos_semanal !== -1 && fotosUsadas >= config.limite_fotos_semanal) {
    return {
      ok: false,
      razon: "limite_fotos",
      usadas: fotosUsadas,
      limite: config.limite_fotos_semanal,
      mensaje: `Alcanzaste tu límite semanal de ${config.limite_fotos_semanal} fotos en tu Plan ${planLabel}. Pasate a un plan superior para seguir mandando fotos.`,
    };
  }

  // Validar total interacciones
  if (config.limite_consultas_semanal !== -1 && consultasUsadas >= config.limite_consultas_semanal) {
    return {
      ok: false,
      razon: "limite_consultas",
      usadas: consultasUsadas,
      limite: config.limite_consultas_semanal,
      mensaje: `Alcanzaste tu límite semanal de ${config.limite_consultas_semanal} consultas en tu Plan ${planLabel}. Pasate a un plan superior para continuar conversando con el Agente.`,
    };
  }

  return { ok: true, mensaje: null, consumos: { audiosUsados, fotosUsadas, consultasUsadas } };
};

// Mantener compatibilidad con llamadas viejas de validarCupoConsultasMensual
const obtenerLimiteConsultasMensual = (planEfectivo) => 999999;
const validarCupoConsultasMensual = async ({ usuarioId, planEfectivo }) => {
  const v = await validarLimitesSemanales({ usuarioId, planEfectivo });
  return { ok: v.ok, usadas: v.consumos?.consultasUsadas || 0, limite: v.limite || 9999 };
};

// Ahora todos los planes acceden a exactamente lo mismo
const puedeUsarAlertas = (planEfectivo) => true;
const puedeUsarFinanzas = (planEfectivo) => true;
const puedeRecibirResumenDiario = (planEfectivo) => true;
const puedeRecibirResumenSemanal = (planEfectivo) => true;

module.exports = {
  normalizarPlan,
  resolverPlanEfectivo,
  obtenerContextoPlanPorWhatsapp,
  actualizarPlanPorWhatsapp,
  obtenerConfigPlan,
  validarLimitesSemanales,
  obtenerLimiteConsultasMensual,
  validarCupoConsultasMensual,
  puedeUsarAlertas,
  puedeUsarFinanzas,
  puedeRecibirResumenDiario,
  puedeRecibirResumenSemanal,
  PLAN_PRICES_CACHE,
  actualizarPrecioCache,
};
