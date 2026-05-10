const crypto = require("crypto");
const axios = require("axios");
const { query } = require("../config/database");
const { normalizarPlan, actualizarPlanPorWhatsapp } = require("./planes");
const { buscarPorWhatsapp } = require("../models/usuario");
const { sendMessage } = require("../config/whatsapp");
const {
  generarPasswordTemporalCliente,
  persistirPasswordTemporalCliente,
  buildTextoCredencialCliente,
  normalizarTelefono,
} = require("./cliente_auth");

const MP_API_BASE = "https://api.mercadopago.com";
const MONEDA_DEFAULT = process.env.MP_CURRENCY_ID || "ARS";
const FRECUENCIA_DEFAULT = Number(process.env.MP_SUB_FREQUENCY || 1);
const FRECUENCIA_TIPO_DEFAULT = process.env.MP_SUB_FREQUENCY_TYPE || "months";

const PLANES = {
  basico: {
    nombre: "Plan Básico",
    monto: Number(process.env.PLAN_BASICO_MONTO || 9000),
  },
  pro: {
    nombre: "Plan Pro",
    monto: Number(process.env.PLAN_PRO_MONTO || 18000),
  },
};

const obtenerAccessToken = () => String(process.env.MP_ACCESS_TOKEN || "").trim();

/** Con credenciales TEST, MP devuelve init_point (prod) y sandbox_init_point. Abrir init_point con usuario test → checkout /fatal/. */
const usarCheckoutSandbox = () => {
  const t = obtenerAccessToken();
  const force = String(process.env.MP_FORCE_SANDBOX_CHECKOUT || "").trim();
  if (force === "1" || force.toLowerCase() === "true") return true;
  if (t.startsWith("TEST-")) return true;
  return false;
};

const elegirInitPoint = (data) => {
  if (!data) return null;
  if (usarCheckoutSandbox() && data.sandbox_init_point) {
    return data.sandbox_init_point;
  }
  return data.init_point || data.sandbox_init_point || null;
};

const headersMp = () => {
  const token = obtenerAccessToken();
  if (!token) throw new Error("MP_ACCESS_TOKEN no configurado");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

const obtenerWebhookUrl = () => String(process.env.MP_WEBHOOK_URL || "").trim();
const obtenerBackUrl = () => String(process.env.MP_SUB_BACK_URL || "").trim();

const armarExternalReference = ({ usuarioId, plan }) =>
  `agrohabilis:u:${Number(usuarioId)}:plan:${normalizarPlan(plan)}:${Date.now()}`;

const registrarSuscripcion = async ({
  usuarioId,
  whatsapp,
  planObjetivo,
  mpPreapprovalId,
  mpPayerId,
  mpInitPoint,
  mpSandboxInitPoint,
  mpStatus,
  mpExternalReference,
  payload,
}) => {
  await query(
    `
      INSERT INTO suscripciones (
        usuario_id,
        whatsapp,
        plan_objetivo,
        mp_preapproval_id,
        mp_payer_id,
        mp_init_point,
        mp_sandbox_init_point,
        mp_status,
        mp_external_reference,
        payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
      ON CONFLICT (mp_preapproval_id)
      DO UPDATE SET
        usuario_id = EXCLUDED.usuario_id,
        whatsapp = EXCLUDED.whatsapp,
        plan_objetivo = EXCLUDED.plan_objetivo,
        mp_payer_id = EXCLUDED.mp_payer_id,
        mp_init_point = EXCLUDED.mp_init_point,
        mp_sandbox_init_point = EXCLUDED.mp_sandbox_init_point,
        mp_status = EXCLUDED.mp_status,
        mp_external_reference = EXCLUDED.mp_external_reference,
        payload = EXCLUDED.payload,
        actualizado_en = NOW()
    `,
    [
      usuarioId,
      whatsapp,
      normalizarPlan(planObjetivo),
      mpPreapprovalId || null,
      mpPayerId || null,
      mpInitPoint || null,
      mpSandboxInitPoint || null,
      mpStatus || null,
      mpExternalReference || null,
      JSON.stringify(payload || {}),
    ]
  );
};

const registrarWebhookSuscripcion = async ({ mpTopic, mpPreapprovalId, payload }) => {
  if (!mpPreapprovalId) return;
  await query(
    `
      INSERT INTO suscripciones_webhooks (
        mp_topic,
        mp_preapproval_id,
        payload
      )
      VALUES ($1,$2,$3::jsonb)
    `,
    [mpTopic || null, mpPreapprovalId, JSON.stringify(payload || {})]
  );
};

const crearLinkSuscripcionParaUsuario = async ({ whatsapp, planObjetivo }) => {
  const plan = normalizarPlan(planObjetivo);
  if (!["basico", "pro"].includes(plan)) {
    throw new Error("Solo se puede generar suscripción para plan basico o pro");
  }
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario?.id) throw new Error("Usuario no encontrado");

  const planCfg = PLANES[plan];
  if (!planCfg || !Number.isFinite(planCfg.monto) || planCfg.monto <= 0) {
    throw new Error(`Monto inválido para plan ${plan}`);
  }

  const externalReference = armarExternalReference({ usuarioId: usuario.id, plan });
  const body = {
    reason: `${planCfg.nombre} AgroHabilis`,
    external_reference: externalReference,
    auto_recurring: {
      frequency: FRECUENCIA_DEFAULT,
      frequency_type: FRECUENCIA_TIPO_DEFAULT,
      transaction_amount: planCfg.monto,
      currency_id: MONEDA_DEFAULT,
    },
    status: "pending",
  };

  const email = String(usuario.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error(
      "Falta email para generar la suscripción. Usá MI EMAIL tucorreo@dominio.com o solo tucorreo@dominio.com"
    );
  }
  body.payer_email = email;
  const backUrl = obtenerBackUrl();
  if (backUrl) body.back_url = backUrl;
  const webhookUrl = obtenerWebhookUrl();
  if (webhookUrl) body.notification_url = webhookUrl;

  const { data } = await axios.post(`${MP_API_BASE}/preapproval`, body, {
    headers: headersMp(),
    timeout: 15000,
  });

  const initParaUsuario = elegirInitPoint(data);

  await registrarSuscripcion({
    usuarioId: usuario.id,
    whatsapp: usuario.whatsapp || whatsapp,
    planObjetivo: plan,
    mpPreapprovalId: data?.id || null,
    mpPayerId: data?.payer_id || null,
    mpInitPoint: data?.init_point || null,
    mpSandboxInitPoint: data?.sandbox_init_point || null,
    mpStatus: data?.status || "pending",
    mpExternalReference: externalReference,
    payload: data,
  });

  return {
    plan,
    planNombre: planCfg.nombre,
    initPoint: initParaUsuario,
    preapprovalId: data?.id || null,
  };
};

const verificarFirmaWebhook = ({ req }) => {
  const secret = String(process.env.MP_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;
  const xSignature = req.get("x-signature");
  if (!xSignature) return false;
  const hash = crypto.createHmac("sha256", secret).update(JSON.stringify(req.body || {})).digest("hex");
  return xSignature.includes(`v1=${hash}`);
};

const obtenerPreapprovalDesdeMP = async (preapprovalId) => {
  const { data } = await axios.get(`${MP_API_BASE}/preapproval/${preapprovalId}`, {
    headers: headersMp(),
    timeout: 15000,
  });
  return data;
};

const extraerPlanDesdeExternalReference = (externalReference = "") => {
  const ref = String(externalReference || "");
  const hit = ref.match(/:plan:(gratis|basico|pro)(?::|$)/i);
  return normalizarPlan(hit?.[1] || "gratis");
};

const actualizarEstadoSuscripcion = async ({
  preapprovalId,
  status,
  payerId,
  externalReference,
  payload,
}) => {
  const r = await query(
    `
      UPDATE suscripciones
      SET
        mp_status = COALESCE($2, mp_status),
        mp_payer_id = COALESCE($3, mp_payer_id),
        mp_external_reference = COALESCE($4, mp_external_reference),
        payload = COALESCE($5::jsonb, payload),
        actualizado_en = NOW()
      WHERE mp_preapproval_id = $1
      RETURNING id, usuario_id, whatsapp, plan_objetivo
    `,
    [preapprovalId, status || null, payerId || null, externalReference || null, JSON.stringify(payload || {})]
  );
  return r.rows[0] || null;
};

const buscarSuscripcionPorPreapprovalId = async (preapprovalId) => {
  const r = await query(
    `
      SELECT id, usuario_id, whatsapp, plan_objetivo, mp_status
      FROM suscripciones
      WHERE mp_preapproval_id = $1
      LIMIT 1
    `,
    [preapprovalId]
  );
  return r.rows[0] || null;
};

const procesarPreapprovalId = async ({
  preapprovalId,
  topic = "",
  payload = {},
  registrarWebhook = false,
}) => {
  if (!preapprovalId) return { ok: true, ignored: true, reason: "sin_preapproval_id" };

  if (registrarWebhook) {
    await registrarWebhookSuscripcion({
      mpTopic: topic,
      mpPreapprovalId: preapprovalId,
      payload: payload || {},
    });
  }

  const subPrev = await buscarSuscripcionPorPreapprovalId(preapprovalId);
  const preapproval = await obtenerPreapprovalDesdeMP(preapprovalId);
  const status = String(preapproval?.status || "").trim().toLowerCase();
  const externalReference = String(preapproval?.external_reference || "").trim();
  const planDesdeRef = extraerPlanDesdeExternalReference(externalReference);
  let sub = await actualizarEstadoSuscripcion({
    preapprovalId,
    status,
    payerId: preapproval?.payer_id || null,
    externalReference,
    payload: preapproval,
  });
  if (!sub) {
    const fallback = await buscarSuscripcionPorPreapprovalId(preapprovalId);
    sub = fallback;
  }
  if (!sub) return { ok: true, ignored: true, reason: "suscripcion_no_registrada", preapprovalId, status };

  const planObjetivo = normalizarPlan(sub.plan_objetivo || planDesdeRef);
  const whatsapp = sub.whatsapp;

  if (status === "authorized") {
    await actualizarPlanPorWhatsapp({
      whatsapp,
      plan: planObjetivo,
    });
    await query(
      `
        UPDATE usuarios
        SET
          mp_suscripcion_id = $2,
          mp_payer_id = COALESCE($3, mp_payer_id)
        WHERE id = $1
      `,
      [sub.usuario_id, preapprovalId, preapproval?.payer_id || null]
    );
    if (["basico", "pro"].includes(planObjetivo) && String(subPrev?.mp_status || "").toLowerCase() !== "authorized") {
      try {
        const usuario = await buscarPorWhatsapp(whatsapp);
        const telefono = normalizarTelefono(usuario?.whatsapp_real || usuario?.whatsapp || whatsapp || "");
        if (usuario?.id && telefono) {
          const plain = generarPasswordTemporalCliente();
          const dashboardLink = String(
            process.env.CLIENT_DASHBOARD_URL || "https://agro.habilispro.com/dashboard/cliente/login"
          ).trim();
          const msg = buildTextoCredencialCliente({
            dashboardLink,
            telefonoMuestra: telefono,
            passwordTemporal: plain,
            variant: "suscripcion",
          });
          await sendMessage(telefono, msg);
          await persistirPasswordTemporalCliente({
            usuarioId: usuario.id,
            telefonoNorm: telefono,
            plain,
          });
        }
      } catch (error) {
        console.error("[mercado_pago] No se pudo enviar credencial cliente:", error.message);
      }
    }
  } else if (["cancelled", "paused"].includes(status)) {
    await actualizarPlanPorWhatsapp({
      whatsapp,
      plan: "gratis",
    });
    if (!["cancelled", "paused"].includes(String(subPrev?.mp_status || "").toLowerCase())) {
      try {
        const usuario = await buscarPorWhatsapp(whatsapp);
        const telefono = normalizarTelefono(usuario?.whatsapp_real || usuario?.whatsapp || whatsapp || "");
        if (telefono) {
          const msg = [
            "✅ Tu desuscripción fue confirmada por Mercado Pago.",
            "Ya quedaste en *Plan GRATIS*.",
            "Podés verificarlo en Mercado Pago > Suscripciones.",
          ].join("\n");
          await sendMessage(telefono, msg);
        }
      } catch (error) {
        console.error("[mercado_pago] No se pudo enviar aviso de desuscripción:", error.message);
      }
    }
  }

  return {
    ok: true,
    preapprovalId,
    status,
    usuarioId: sub.usuario_id,
    planObjetivo,
  };
};

const procesarWebhookSuscripcion = async ({ req }) => {
  if (!verificarFirmaWebhook({ req })) {
    throw new Error("Firma webhook inválida");
  }
  const topic = String(req.query.topic || req.body?.type || req.body?.topic || "").trim().toLowerCase();
  const preapprovalId = String(req.query.id || req.body?.data?.id || "").trim();
  return procesarPreapprovalId({
    preapprovalId,
    topic,
    payload: req.body || {},
    registrarWebhook: true,
  });
};

const reconciliarSuscripcionesPendientes = async ({ limit = 30 } = {}) => {
  const r = await query(
    `
      SELECT mp_preapproval_id
      FROM suscripciones
      WHERE mp_status = 'pending'
      ORDER BY actualizado_en DESC, id DESC
      LIMIT $1
    `,
    [Math.max(1, Math.min(200, Number(limit) || 30))]
  );
  const out = {
    total: r.rows.length,
    procesadas: 0,
    autorizadas: 0,
    canceladas: 0,
    pausadas: 0,
    errores: [],
  };
  for (const row of r.rows) {
    const preapprovalId = String(row.mp_preapproval_id || "").trim();
    if (!preapprovalId) continue;
    try {
      const x = await procesarPreapprovalId({
        preapprovalId,
        topic: "reconcile",
        payload: { source: "reconcile" },
        registrarWebhook: false,
      });
      out.procesadas += 1;
      if (x?.status === "authorized") out.autorizadas += 1;
      else if (x?.status === "cancelled") out.canceladas += 1;
      else if (x?.status === "paused") out.pausadas += 1;
    } catch (error) {
      out.errores.push({ preapprovalId, error: error.message });
    }
  }
  return out;
};

const obtenerSuscripcionCancelablePorUsuario = async (usuarioId) => {
  const r = await query(
    `
      SELECT id, mp_preapproval_id, mp_status, plan_objetivo
      FROM suscripciones
      WHERE usuario_id = $1
        AND mp_preapproval_id IS NOT NULL
        AND LOWER(COALESCE(mp_status, '')) IN ('authorized', 'pending', 'paused')
      ORDER BY actualizado_en DESC, id DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  return r.rows[0] || null;
};

const obtenerSuscripcionIdUsuario = async (usuarioId) => {
  const r = await query(
    `
      SELECT mp_suscripcion_id
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const id = String(r.rows?.[0]?.mp_suscripcion_id || "").trim();
  return id || null;
};

const cancelarSuscripcionMpPorWhatsapp = async ({ whatsapp }) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario?.id) {
    return { ok: false, reason: "usuario_no_encontrado" };
  }
  const sub = await obtenerSuscripcionCancelablePorUsuario(usuario.id);
  const preapprovalId = sub?.mp_preapproval_id || (await obtenerSuscripcionIdUsuario(usuario.id));
  if (!preapprovalId) {
    await actualizarPlanPorWhatsapp({ whatsapp, plan: "gratis" });
    return { ok: true, cancelledInMp: false, reason: "sin_suscripcion_activa" };
  }

  try {
    await axios.put(
      `${MP_API_BASE}/preapproval/${preapprovalId}`,
      { status: "cancelled" },
      { headers: headersMp(), timeout: 15000 }
    );
    const sync = await procesarPreapprovalId({
      preapprovalId,
      topic: "manual_cancel",
      payload: { source: "manual_cancel_whatsapp" },
      registrarWebhook: false,
    });
    await actualizarPlanPorWhatsapp({ whatsapp, plan: "gratis" });
    return {
      ok: true,
      cancelledInMp: true,
      preapprovalId,
      status: sync?.status || "cancelled",
    };
  } catch (error) {
    await actualizarPlanPorWhatsapp({ whatsapp, plan: "gratis" });
    return {
      ok: false,
      cancelledInMp: false,
      preapprovalId,
      reason: "mp_cancel_error",
      error: error.message,
    };
  }
};

const solicitarCancelacionSuscripcionMpPorWhatsapp = async ({ whatsapp }) => {
  const usuario = await buscarPorWhatsapp(whatsapp);
  if (!usuario?.id) return { ok: false, reason: "usuario_no_encontrado" };
  const sub = await obtenerSuscripcionCancelablePorUsuario(usuario.id);
  const preapprovalId = sub?.mp_preapproval_id || (await obtenerSuscripcionIdUsuario(usuario.id));
  if (!preapprovalId) return { ok: true, reason: "sin_suscripcion_activa" };
  try {
    await axios.put(
      `${MP_API_BASE}/preapproval/${preapprovalId}`,
      { status: "cancelled" },
      { headers: headersMp(), timeout: 10000 }
    );
    return { ok: true, enProceso: true, preapprovalId };
  } catch (error) {
    return { ok: false, reason: "mp_cancel_request_error", preapprovalId, error: error.message };
  }
};

module.exports = {
  crearLinkSuscripcionParaUsuario,
  cancelarSuscripcionMpPorWhatsapp,
  solicitarCancelacionSuscripcionMpPorWhatsapp,
  procesarWebhookSuscripcion,
  reconciliarSuscripcionesPendientes,
};
