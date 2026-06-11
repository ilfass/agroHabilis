"use strict";

/**
 * Helpers para el flujo de cambio de plan del productor.
 *
 * Originalmente eran funciones LOCALES dentro de `src/config/whatsapp.js`
 * (historial git, ~líneas 132-182). Se extrajeron al preparar el paso G
 * del TurnController (P2#10), para que el handler `cmd_cambio_plan`
 * pueda usarlas sin acoplarse a símbolos internos de `whatsapp.js`, y
 * para que otros puntos del código (el "early path" pre-router de
 * `procesarMensajeEntranteWhatsapp` y el flujo de pago vía API) puedan
 * compartir exactamente la misma lógica.
 *
 * Dos exports:
 * - `resolverCambioPlanConPago({ whatsapp, planObjetivo })`: orquesta el
 *   cambio. Si va a básico/pro genera un link de suscripción de MP. Si
 *   va a gratis, solicita cancelación de la suscripción activa y baja
 *   el plan localmente. Devuelve el texto a responderle al usuario.
 * - `mensajeErrorCambioPlan(error)`: traduce un error genérico a un
 *   mensaje útil para el usuario (el caso típico es "falta email").
 */

const { actualizarPlanPorWhatsapp } = require("./planes");
const {
  crearLinkSuscripcionParaUsuario,
  solicitarCancelacionSuscripcionMpPorWhatsapp,
} = require("./mercado_pago");

const resolverCambioPlanConPago = async ({ whatsapp, planObjetivo }) => {
  if (["basico", "pro", "pro_max"].includes(planObjetivo)) {
    const pago = await crearLinkSuscripcionParaUsuario({
      whatsapp,
      planObjetivo,
    });
    return [
      `Perfecto. Para activar *${String(pago.planNombre || planObjetivo).toUpperCase()}* completá la suscripción acá:`,
      `${pago.initPoint}`,
      "",
      "Cuando Mercado Pago confirme el cobro, te activo el plan automáticamente.",
    ].join("\n");
  }
  const cancelReq = await solicitarCancelacionSuscripcionMpPorWhatsapp({ whatsapp });
  const actualizado = await actualizarPlanPorWhatsapp({ whatsapp, plan: "gratis" });
  const txtPlan = String(actualizado?.plan || "gratis").toUpperCase();
  if (cancelReq?.enProceso) {
    return [
      `✅ Plan actualizado: *${txtPlan}*.`,
      "Estamos procesando la desuscripción en Mercado Pago.",
      "Cuando se confirme, te vamos a avisar por este chat.",
      "Incluye resumen semanal y consultas limitadas.",
    ].join("\n");
  }
  if (cancelReq?.reason === "sin_suscripcion_activa") {
    return [
      `✅ Plan actualizado: *${txtPlan}*.`,
      "No encontré una suscripción activa en MP para cancelar.",
      "Si querés, podés verificarlo en Mercado Pago > Suscripciones.",
      "Incluye resumen semanal y consultas limitadas.",
    ].join("\n");
  }
  return [
    `✅ Plan actualizado: *${txtPlan}*.`,
    "No pude iniciar la cancelación automática en MP ahora.",
    "Podés intentar de nuevo en unos minutos.",
    "Podés cancelarla manualmente en Mercado Pago > Suscripciones.",
    "Incluye resumen semanal y consultas limitadas.",
  ].join("\n");
};

const mensajeErrorCambioPlan = (error) => {
  const msg = String(error?.message || "");
  if (/falta email/i.test(msg)) {
    return (
      "Para activar Plan Básico o Pro primero necesito tu email.\n" +
      "Podés usar: *MI EMAIL tucorreo@dominio.com* o mandar solo *tucorreo@dominio.com*"
    );
  }
  return "No pude gestionar tu cambio de plan ahora 😓. Probá de nuevo en unos minutos.";
};

module.exports = {
  resolverCambioPlanConPago,
  mensajeErrorCambioPlan,
};
