"use strict";

/**
 * Handler: `cmd_completar_perfil` — inicio del flujo de completar perfil.
 *
 * Origen: `src/config/whatsapp.js` líneas 1337-1344.
 *
 * Solo cubre la rama "iniciar por intent IA" (`comandoNatural ===
 * "COMPLETAR PERFIL"`). El segundo punto (whatsapp.js ~1705) es un GATE
 * stateful que intercepta TODO mensaje cuando el usuario está en medio
 * del flujo — ese se migrará en paso L junto con el resto de gates
 * stateful (onboarding, resumen_interactivo, inventario_pendiente).
 *
 * Diferencia clave con otros handlers: si el flujo NO inicia, dejamos
 * pasar (`manejado: false`) — el original cae a las ramas siguientes.
 *
 * Migrado en: P2#10 paso J.
 */

const { gestionarCompletarPerfil } = require("../onboarding");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdCompletarPerfil(ctx) {
  const natural = String(ctx?.comandoNatural || "").toUpperCase();
  if (natural !== "COMPLETAR PERFIL") return { manejado: false };

  const inicio = await gestionarCompletarPerfil(ctx.jid, "COMPLETAR PERFIL");
  if (inicio?.enFlujo) {
    return {
      manejado: true,
      respuesta: inicio.respuesta,
      route: "CMDN_COMPLETAR_PERFIL",
      extraLog: { en_flujo: true },
    };
  }
  /**
   * No inició: dejamos pasar para que las siguientes ramas (cambio de
   * plan, etc.) sigan teniendo su chance.
   */
  return { manejado: false };
}

module.exports = { handlerCmdCompletarPerfil };
