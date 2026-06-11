"use strict";

/**
 * Gate de dominio del turno: **solo cadena IA** cuando hay proveedor;
 * sin heurísticas locales de timing / no‑agro (eso lo ve el modelo).
 */

const {
  obtenerUltimasInteracciones,
  construirPreguntaConHiloInterpretado,
} = require("../../consultas/contexto");
const { AGENT_PROMPT_VERSION, buildAgentDominioTurnoSystem } = require("../prompts/builders");
const { hayProveedorIa, ejecutarJsonConCadenaIA } = require("../ia/json_chain");
const {
  cursorMode,
  historialHiloPromptTurnos,
  dominioHistorialLimite,
} = require("../cursor_mode");

const REPREGUNTA_DOMINIO_FIJA = [
  "Eso queda fuera de lo que puedo resolver bien desde *AgroHabilis* (mi fuerte es campo: precios, clima, mercado, cargar o consultar tus datos y los comandos del bot).",
  "",
  "¿Seguimos por acá? Escribime en *una línea* qué necesitás, por ejemplo: *precio soja*, *clima mañana en mi zona*, *mi inventario*, *mis gastos del mes* o *ver comandos*.",
].join("\n");

const INTENCIONES_QUE_SALTAN_GATE = new Set([
  "comando",
  "registrar",
  "precio",
  "clima",
  "analisis_mercado",
  "analisis_interno",
  "consulta_registros",
]);

const envAgentDominioEncendido = () => {
  const v = String(process.env.AGENT_DOMINIO_TURNO ?? "1")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
};

const dominioModoHibrido = () =>
  String(process.env.AGENT_DOMINIO_MODO || "")
    .trim()
    .toLowerCase() === "hibrido";

function pushAgentTurnTrace(clasificacion, evento) {
  if (!clasificacion || typeof clasificacion !== "object") return;
  if (!Array.isArray(clasificacion.agentTurnTrace)) clasificacion.agentTurnTrace = [];
  clasificacion.agentTurnTrace.push({
    etapa: "agent_turn_dominio",
    ts: Date.now(),
    prompt_version: AGENT_PROMPT_VERSION,
    ...evento,
  });
}

function debeEjecutarGateDominio(clasificacion, mensaje) {
  if (!envAgentDominioEncendido()) return false;
  const int = String(clasificacion?.intencion || "");
  if (INTENCIONES_QUE_SALTAN_GATE.has(int)) return false;
  if (int === "saludo" || int === "small_talk") {
    const m = String(mensaje || "").trim();
    if (m.length <= 60 && !/\?/.test(m) && !/\d/.test(m)) return false;
  }
  return true;
}

async function llamarDominioJson({ clasificacion, mensaje, usuario, numeroWhatsapp, modoPrompt, historialPrecargado }) {
  const lim = dominioHistorialLimite();
  let ultimas = [];
  if (Array.isArray(historialPrecargado) && historialPrecargado.length) {
    ultimas = historialPrecargado.slice(0, lim);
  } else {
    try {
      ultimas = await obtenerUltimasInteracciones({
        usuarioId: usuario?.es_delegado ? null : (usuario?.id || null),
        whatsapp: numeroWhatsapp || null,
        limite: lim,
      });
    } catch (_e) {
      ultimas = [];
    }
  }

  const int = String(clasificacion?.intencion || "");
  const userIa = [
    `Intención del clasificador (referencia interna; puede estar errada): \`${int}\``,
    construirPreguntaConHiloInterpretado(mensaje, ultimas, "duda", {
      maxTurnosHilo: historialHiloPromptTurnos(),
    }),
  ].join("\n\n");

  return ejecutarJsonConCadenaIA({
    system: buildAgentDominioTurnoSystem({ modo: modoPrompt }),
    user: userIa,
    maxTokens: modoPrompt === "solo_ia" ? 320 : 220,
    contextLabel: "IA.agent_turn_dominio",
    orderEnvVar: "AGENT_DOMINIO_IA_ORDER",
  });
}

async function evaluarDominioTurnoAntesDeRouter({
  clasificacion,
  mensaje,
  usuario,
  numeroWhatsapp,
  historialPrecargado = null,
}) {
  if (!debeEjecutarGateDominio(clasificacion, mensaje)) {
    return { accion: "delegar", texto: null };
  }

  const int = String(clasificacion?.intencion || "");
  const tieneIa = hayProveedorIa();

  if (!tieneIa) {
    if (int === "no_agro") {
      pushAgentTurnTrace(clasificacion, {
        ok: true,
        via: "sin_ia_clasificador_no_agro",
        modo: "fallback",
        emitioRepregunta: true,
      });
      return { accion: "repregunta_dominio", texto: REPREGUNTA_DOMINIO_FIJA };
    }
    return { accion: "delegar", texto: null };
  }

  try {
    const modoPrompt = dominioModoHibrido() ? "hibrido" : "solo_ia";
    const { parsed, providerUsed, model, trace } = await llamarDominioJson({
      clasificacion,
      mensaje,
      usuario,
      numeroWhatsapp,
      modoPrompt,
      historialPrecargado,
    });
    const alcance = String(parsed?.alcance || "").toLowerCase();
    const conf = Number(parsed?.confianza);
    const rep = String(parsed?.repregunta || "").trim();

    if (alcance === "fuera_de_foco" && Number.isFinite(conf) && conf >= 0.52) {
      const texto = rep.length >= 30 ? rep.slice(0, 1400) : REPREGUNTA_DOMINIO_FIJA;
      pushAgentTurnTrace(clasificacion, {
        ok: true,
        via: "ia_json",
        modo: modoPrompt,
        alcance,
        confianza: conf,
        providerUsed,
        model,
        iaTrace: trace,
        emitioRepregunta: true,
      });
      return { accion: "repregunta_dominio", texto };
    }
  } catch (_e) {
    /* delegar */
  }

  return { accion: "delegar", texto: null };
}

module.exports = {
  evaluarDominioTurnoAntesDeRouter,
  debeEjecutarGateDominio,
  dominioModoHibrido,
  REPREGUNTA_DOMINIO_FIJA,
};
