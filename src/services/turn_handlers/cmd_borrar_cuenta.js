"use strict";

/**
 * Handler: `cmd_borrar_cuenta` — flujo destructivo en dos pasos.
 *
 * Origen: `src/config/whatsapp.js` líneas 1293-1335.
 *
 * Dos ramas:
 * - Paso 1 (pedido): variantes de BORRAR/ELIMINAR/BAJA en alias o
 *   `BORRAR MIS DATOS` natural → muestra advertencia + frase exacta.
 * - Paso 2 (confirmación): texto EXACTAMENTE `SI BORRO MIS DATOS` →
 *   ejecuta `eliminarUsuarioSoft`.
 *
 * Migrado en: P2#10 paso H.
 *
 * Usa `replySinIA` siempre (no debe enriquecerse por IA libre cuando se
 * trata de borrado de datos).
 */

const { eliminarUsuarioSoft } = require("../../models/usuario");

const PEDIDOS_BORRADO = new Set([
  "BORRAR MIS DATOS",
  "ELIMINAR MI CUENTA",
  "ELIMINAR MIS DATOS",
  "DAR DE BAJA MI CUENTA",
  "BAJA MI CUENTA",
  "BORRAR MI CUENTA",
]);

const MSG_PASO1 = [
  "⚠️ *Borrado definitivo*",
  "",
  "Se van a eliminar tu usuario, perfil, cultivos, zona, alertas, gastos/ventas, resúmenes e historial de consultas en AgroHabilis.",
  "Esta acción *no se puede deshacer*.",
  "",
  "Si estás seguro, respondé *en una sola línea y exactamente*:",
  "*SI BORRO MIS DATOS*",
  "",
  "Si no querés borrar nada, ignorá este mensaje.",
].join("\n");

const responderConReplySinIA = async (ctx, texto, route, extraLog) => {
  if (typeof ctx.replySinIA === "function") {
    await ctx.replySinIA(texto);
    return { manejado: true, respuesta: null, route, extraLog };
  }
  return { manejado: true, respuesta: texto, route, extraLog };
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdBorrarCuenta(ctx) {
  const comandoUpper = String(ctx?.comandoUpper || "").toUpperCase();
  const natural = String(ctx?.comandoNatural || "").toUpperCase();
  const comandoNorm = comandoUpper.replace(/\s+/g, " ").trim();

  /** Paso 1 — pedido. */
  if (PEDIDOS_BORRADO.has(comandoNorm) || natural === "BORRAR MIS DATOS") {
    if (!ctx?.planCtx?.usuario?.id) {
      return responderConReplySinIA(
        ctx,
        "No hay una cuenta registrada con este número.",
        "CMD_BORRAR_CUENTA_PASO1",
        { sin_usuario: true }
      );
    }
    return responderConReplySinIA(ctx, MSG_PASO1, "CMD_BORRAR_CUENTA_PASO1");
  }

  /** Paso 2 — confirmación. */
  if (comandoNorm === "SI BORRO MIS DATOS") {
    if (!ctx?.planCtx?.usuario?.id) {
      return responderConReplySinIA(
        ctx,
        "No hay una cuenta registrada con este número.",
        "CMD_BORRAR_CUENTA_CONFIRMADO",
        { sin_usuario: true }
      );
    }
    try {
      const eliminado = await eliminarUsuarioSoft(ctx.planCtx.usuario.id);
      if (!eliminado) {
        return responderConReplySinIA(
          ctx,
          "No pude encontrar la cuenta para borrar. Si el problema sigue, contactá soporte.",
          "CMD_BORRAR_CUENTA_CONFIRMADO",
          { eliminado: false }
        );
      }
      return responderConReplySinIA(
        ctx,
        "✅ *Listo.* Eliminé tu cuenta y los datos vinculados a este WhatsApp.\n\nGracias por haber usado AgroHabilis. Si más adelante querés volver, escribinos y empezamos un perfil nuevo.",
        "CMD_BORRAR_CUENTA_CONFIRMADO",
        { eliminado: true }
      );
    } catch (e) {
      console.error("[CMD_BORRAR_CUENTA] error:", e?.message || e);
      return responderConReplySinIA(
        ctx,
        "No pude completar el borrado en este momento. Probá de nuevo en unos minutos o escribinos por soporte.",
        "CMD_BORRAR_CUENTA_CONFIRMADO_ERROR",
        { error: String(e?.message || e) }
      );
    }
  }

  return { manejado: false };
}

module.exports = { handlerCmdBorrarCuenta, PEDIDOS_BORRADO };
