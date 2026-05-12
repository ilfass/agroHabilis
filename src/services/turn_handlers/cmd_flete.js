"use strict";

/**
 * Handler: `cmd_flete` — calcula flete de granos entre dos puntos.
 *
 * Origen: `src/config/whatsapp.js` líneas 1816-1836.
 * Comando: `FLETE <origen> A <destino>` (ej: `FLETE Tandil A Rosario`).
 *
 * Migrado en: P2#10 paso B.
 *
 * Características:
 * - Sin estado conversacional, sin DB de usuario.
 * - Llama a `services/fletes.calcularFlete` (mismo que el código original).
 * - Si no matchea el patrón, devuelve `{ manejado: false }` y el
 *   controlador pasa al siguiente handler.
 */

const { calcularFlete } = require("../fletes");

/**
 * Parser local idéntico al de whatsapp.js (línea 122). Lo dejamos como
 * función privada de este handler para no acoplarnos a un export externo
 * que puede cambiar.
 */
const parseComandoFlete = (texto = "") => {
  const m = String(texto || "").match(/^FLETE\s+(.+?)\s+A\s+(.+)$/i);
  if (!m) return null;
  return { origen: m[1].trim(), destino: m[2].trim() };
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdFlete(ctx) {
  /**
   * En el flujo original (línea 1816), el match se hace sobre `comando`,
   * que es `consulta` pasado por `normalizarParaComandoRuteo` (NFD +
   * uppercase). Aceptamos ambas formas: `ctx.comandoUpper` (preferido) o
   * `ctx.consulta` como fallback.
   */
  const textoMatch = ctx?.comandoUpper || ctx?.consulta || "";
  const cmd = parseComandoFlete(textoMatch);
  if (!cmd) return { manejado: false };

  const data = await calcularFlete(cmd.origen, cmd.destino, "granos", 28);
  if (data?.error) {
    return {
      manejado: true,
      respuesta: `No pude calcular ese flete: ${data.error}`,
      route: "CMD_FLETE",
      extraLog: { error: data.error },
    };
  }

  const respuesta = [
    `📦 Flete ${cmd.origen} → ${cmd.destino}`,
    `Distancia: ${data.distancia_km || "s/d"} km`,
    `Tarifa actual: USD ${Number(data.tarifa_usd_km_tn || 0).toFixed(5)}/km/tn`,
    `Costo flete: USD ${Number(data.costo_usd_tn || 0).toFixed(2)}/tn`,
    `Costo total (28 tn): USD ${Number(data.costo_total_usd || 0).toFixed(2)}`,
    `Peajes estimados: $${Number(data.peajes_ars || 0).toLocaleString("es-AR")}`,
    `(Ajustado por gasoil actual $${Number(data.gasoil_actual_ars || 0).toLocaleString("es-AR")}/lt)`,
  ].join("\n");

  return {
    manejado: true,
    respuesta,
    route: "CMD_FLETE",
    extraLog: { origen: cmd.origen, destino: cmd.destino, km: data.distancia_km || null },
  };
}

module.exports = { handlerCmdFlete, parseComandoFlete };
