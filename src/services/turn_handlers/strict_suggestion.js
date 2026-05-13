"use strict";

/**
 * Handler: `strict_suggestion` — modo estricto pre-IA-libre.
 *
 * Origen: `src/config/whatsapp.js` líneas 1886-1898.
 *
 * Si el mensaje parece intención de comando (comandoNatural detectado o
 * `pareceComandoExplicito` por prefijo), NO lo dejamos pasar a IA libre.
 * Se devuelve la sugerencia del catálogo o se invita a ver el listado.
 *
 * Excepción: consultas operativas/onboarding (típicas de mercado o
 * agro) sí siguen al pipeline. Replicamos `esConsultaOperativaOnboarding`
 * localmente (igual que en `cmd_finanzas`) para no acoplar a un símbolo
 * interno de whatsapp.js.
 *
 * Migrado en: P2#10 paso K.
 */

const {
  normalizarTexto,
  sugerirComandoPorTexto,
} = require("../whatsapp_intents");

/** `pareceComandoExplicito` (whatsapp.js ~340) replicado para no acoplar. */
const pareceComandoExplicitoLocal = (consulta = "", comando = "") => {
  const c = String(comando || "").trim().toUpperCase();
  if (!c) return false;
  const starts = [
    "MI ",
    "MIS ",
    "VER ",
    "QUIERO PLAN ",
    "ALERTA ",
    "AVISAME ",
    "CANCELAR ALERTA",
    "COMPLETAR PERFIL",
    "FLETE ",
    "RESET ONBOARDING",
  ];
  return starts.some((s) => c.startsWith(s));
};

/** `esConsultaOperativaOnboarding` (whatsapp.js ~328) replicado. */
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
async function handlerStrictSuggestion(ctx) {
  const consulta = ctx?.consulta || "";
  const alias = String(ctx?.comandoAlias || "").toUpperCase();
  const natural = String(ctx?.comandoNatural || "").toUpperCase();

  /** Si no parece comando (ni natural ni explícito), dejamos pasar. */
  if (!natural && !pareceComandoExplicitoLocal(consulta, alias)) {
    return { manejado: false };
  }
  /** Si es consulta operativa/onboarding agro, sigue al pipeline. */
  if (esConsultaOperativaOnboardingLocal(consulta)) {
    return { manejado: false };
  }

  const sugerencia = sugerirComandoPorTexto(consulta);
  if (sugerencia) {
    return {
      manejado: true,
      respuesta: sugerencia,
      route: "STRICT_SUGGESTION",
      extraLog: { sugerencia: true, comandoNatural: natural || null },
    };
  }
  /**
   * Modo agente: si NO hay sugerencia clara del catálogo, NO cortamos al
   * usuario con texto fijo "Escribí VER COMANDOS". Dejamos pasar al
   * `pipeline_agente` para que el LLM entienda la intención (puede ser
   * meta-charla, ambigüedad, o consulta que la heurística no clasificó).
   *
   * El handler queda solo como "sugerencia rápida si pega exacto",
   * nunca como blocker.
   */
  return { manejado: false, extraLog: { sugerencia: false, comandoNatural: natural || null } };
}

module.exports = { handlerStrictSuggestion };
