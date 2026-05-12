"use strict";

/**
 * Handler: `cmd_admin` — comandos solo para administradores.
 *
 * Origen: `src/config/whatsapp.js` líneas 1239-1281.
 *
 * Comandos cubiertos:
 * - Cualquiera del catálogo de `responderComandoAdmin`
 *   (ESTADO/ESTADO SISTEMA/ESTADO IA/ESTADO DB/USUARIOS/FUENTES).
 * - `RESET ONBOARDING <numero>` con respuesta detallada del soft-delete.
 *
 * Migrado en: P2#10 paso I.
 *
 * Detalles importantes:
 * - El handler no decide quién es admin; lo recibe en `ctx.esAdmin`,
 *   que `whatsapp.js` calcula con `esAdminWhatsapp(msg.from)`.
 * - `responderComandoAdmin` necesita saber el estado runtime de
 *   WhatsApp; se lo pasamos vía `ctx.getEstadoWhatsapp`.
 * - Para RESET ONBOARDING gate-eamos por `esAdmin` antes de tocar DB.
 */

const {
  responderComandoAdmin,
  resetOnboardingNumero,
} = require("../admin_comandos");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdAdmin(ctx) {
  const alias = String(ctx?.comandoAlias || "").toUpperCase();
  const consulta = String(ctx?.consulta || "");

  // ---------- RESET ONBOARDING (admin) ----------
  if (alias.startsWith("RESET ONBOARDING")) {
    if (!ctx?.esAdmin) {
      return {
        manejado: true,
        respuesta: "Este comando es solo para administradores.",
        route: "CMD_RESET_ONBOARDING_DENEGADO",
      };
    }
    const numeroObjetivo = consulta.replace(/reset onboarding/i, "").trim();
    const r = await resetOnboardingNumero(numeroObjetivo);
    if (!r.ok) {
      return {
        manejado: true,
        respuesta: `❌ ${r.error}`,
        route: "CMD_RESET_ONBOARDING_ERR",
        extraLog: { error: r.error },
      };
    }
    return {
      manejado: true,
      respuesta: [
        `✅ Onboarding reseteado para ${r.numero}`,
        `- onboarding_estado: ${r.onboarding}`,
        `- whatsapp_bot_control: ${r.botControl}`,
        `- historial_consultas (sin usuario): ${r.consultasNull}`,
        `- usuarios eliminados: ${r.usuariosEliminados || 0}`,
        "",
        "El próximo mensaje de ese número iniciará onboarding desde cero.",
      ].join("\n"),
      route: "CMD_RESET_ONBOARDING_OK",
      extraLog: {
        numero: r.numero,
        usuariosEliminados: r.usuariosEliminados,
      },
    };
  }

  // ---------- Catálogo admin (ESTADO/USUARIOS/FUENTES/...) ----------
  const respuesta = await responderComandoAdmin(ctx.jid, alias, {
    esAdmin: Boolean(ctx?.esAdmin),
    getEstadoWhatsapp: ctx?.getEstadoWhatsapp,
  });
  if (respuesta == null) return { manejado: false };

  /**
   * Distinguir denegación de respuestas válidas: el módulo devuelve un
   * string fijo cuando hay denegación, ayuda para el log.
   */
  const route = /Este comando es solo/i.test(respuesta) ? "CMD_ADMIN_DENEGADO" : "CMD_ADMIN";
  return {
    manejado: true,
    respuesta,
    route,
    extraLog: { alias },
  };
}

module.exports = { handlerCmdAdmin };
