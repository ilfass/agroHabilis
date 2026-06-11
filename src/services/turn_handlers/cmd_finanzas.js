"use strict";

/**
 * Handler: `cmd_finanzas` — registro y consulta de gastos/ventas/margen.
 *
 * Unifica seis ramas del whatsapp.js viejo:
 * - GASTÉ / COMPRÉ / __GASTO__ (línea 1759) → registrar gasto.
 * - VENDÍ / __VENTA__ (línea 1778) → registrar venta (con guardas extra).
 * - MIS GASTOS (línea 1795) → texto.
 * - MIS VENTAS (línea 1806) → texto.
 * - MI MARGEN (línea 1817) → texto.
 *
 * Migrado en: P2#10 paso E.
 *
 * Pre-condición común: `puedeUsarFinanzas(planEfectivo)`. Si no, mensaje
 * según rama orientando a Plan Pro.
 *
 * Importante: para VENDÍ replicamos las dos guardas del original:
 * - `esConsultaOperativaOnboarding` evita confundir "me conviene vender"
 *   con un registro de venta.
 * - `esConsultaMercadoExcluyeRegistroVenta` evita confundir consultas de
 *   mercado del estilo "¿conviene vender hoy?" con un registro.
 *
 * `esConsultaOperativaOnboarding` está como función local en whatsapp.js
 * (no exportada). Replicamos su lógica acá literalmente para no acoplar
 * el handler a un símbolo interno de otro archivo.
 */

const {
  registrarGasto,
  registrarVenta,
  obtenerTextoMisGastos,
  obtenerTextoMisVentas,
  obtenerTextoMiMargen,
} = require("../gastos");
const { puedeUsarFinanzas } = require("../planes");
const {
  normalizarTexto,
  esConsultaMercadoExcluyeRegistroVenta,
} = require("../whatsapp_intents");

/** Replica privada de `esConsultaOperativaOnboarding` (whatsapp.js ~328). */
const esConsultaOperativaOnboardingLocal = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return false;
  if (/\bme conviene vender\b|\bconviene vender\b|\bque conviene vender\b/.test(t)) return true;
  if (/lectura r[aá]pida|no me cierr|decidir fino|mezcl\w* fuente|backwardation|carry|spread/.test(t)) return true;
  if (/\bprecio\b.*\bhoy\b|\bcotizacion\b.*\bhoy\b|\bcotizacion\b/.test(t)) return true;
  if (/\bcomo viene\b.*\bcosecha\b|\bcosecha gruesa\b/.test(t)) return true;
  if (/\bclima\b.*\b7 dias\b|\bclima\b.*\bsemana\b/.test(t)) return true;
  if (/\bternero\b|\bhacienda\b|\bganado\b|\bcria\b|\bcría\b/.test(t)) return true;
  return false;
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdFinanzas(ctx) {
  const alias = String(ctx?.comandoAlias || "").toUpperCase();
  const natural = String(ctx?.comandoNatural || "").toUpperCase();
  const planEf = ctx?.planCtx?.planEfectivo;
  const consulta = ctx?.consulta || "";

  /** GASTO */
  if (
    alias.startsWith("GASTE") ||
    alias.startsWith("GASTÉ") ||
    alias.startsWith("COMPRE") ||
    alias.startsWith("COMPRÉ") ||
    natural === "__GASTO__"
  ) {
    if (!puedeUsarFinanzas(planEf)) {
      return {
        manejado: true,
        respuesta:
          "El registro de gastos está disponible en Plan Pro. Escribí 'QUIERO PLAN PRO' para activarlo.",
        route: "CMD_GASTO",
      };
    }
    const r = await registrarGasto(ctx.planCtx?.usuario || ctx.jid, consulta);
    return { manejado: true, respuesta: r, route: "CMD_GASTO" };
  }

  /** VENTA (con guardas anti-falso-positivo) */
  if (
    (alias.startsWith("VENDI") || alias.startsWith("VENDÍ") || natural === "__VENTA__") &&
    !esConsultaOperativaOnboardingLocal(consulta) &&
    !esConsultaMercadoExcluyeRegistroVenta(consulta)
  ) {
    if (!puedeUsarFinanzas(planEf)) {
      return {
        manejado: true,
        respuesta:
          "El registro de ventas está disponible en Plan Pro. Escribí 'QUIERO PLAN PRO' para activarlo.",
        route: "CMD_VENTA",
      };
    }
    const r = await registrarVenta(ctx.planCtx?.usuario || ctx.jid, consulta);
    return { manejado: true, respuesta: r, route: "CMD_VENTA" };
  }

  /** Consultas (read-only) */
  const lookupsRO = [
    { alias: "MIS GASTOS", fn: obtenerTextoMisGastos, route: "CMD_MIS_GASTOS" },
    { alias: "MIS VENTAS", fn: obtenerTextoMisVentas, route: "CMD_MIS_VENTAS" },
  ];
  for (const lu of lookupsRO) {
    if (alias === lu.alias) {
      if (!puedeUsarFinanzas(planEf)) {
        return {
          manejado: true,
          respuesta: "Esta funcionalidad está disponible en Plan Pro.",
          route: lu.route,
        };
      }
      const r = await lu.fn(ctx.planCtx?.usuario || ctx.jid);
      return { manejado: true, respuesta: r, route: lu.route };
    }
  }

  /** MI MARGEN (alias + natural) */
  if (alias === "MI MARGEN" || natural === "MI MARGEN") {
    if (!puedeUsarFinanzas(planEf)) {
      return {
        manejado: true,
        respuesta: "Esta funcionalidad está disponible en Plan Pro.",
        route: "CMD_MI_MARGEN",
      };
    }
    const r = await obtenerTextoMiMargen(ctx.planCtx?.usuario || ctx.jid);
    return { manejado: true, respuesta: r, route: "CMD_MI_MARGEN" };
  }

  return { manejado: false };
}

module.exports = { handlerCmdFinanzas, esConsultaOperativaOnboardingLocal };
