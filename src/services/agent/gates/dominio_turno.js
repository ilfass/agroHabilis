"use strict";

/**
 * Gate de dominio del turno (agro operativo vs fuera de foco).
 * @see docs en `agent/pipeline` — forma parte del pipeline tipo agente.
 */

const {
  obtenerUltimasInteracciones,
  construirPreguntaConHiloInterpretado,
} = require("../../consultas/contexto");
const {
  esProbableConocimientoGeneralSinAgro,
  esActualidadGeopoliticaSinAnclaAgro,
  esProbableNoAgroDeportesOcio,
} = require("../../intent_classifier");
const { AGENT_PROMPT_VERSION, buildAgentDominioTurnoSystem } = require("../prompts/builders");
const { hayProveedorIa, ejecutarJsonConCadenaIA } = require("../ia/json_chain");

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

const normMsg = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function esConsultaTimingMercadoAgro(mensaje = "") {
  const t = normMsg(mensaje);
  if (!t) return false;
  if (/\b(me\s+)?conviene\s+vender\b|\bdebo\s+vender\b|\bvender\s+o\s+esperar\b|\besperar\s+o\s+vender\b/.test(t)) return true;
  if (/\bconviene\s+comprar\b|\bme\s+conviene\s+comprar\b/.test(t)) return true;
  if (/\bconviene\b/.test(t) && /\bvender\b/.test(t)) return true;
  return false;
}

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

function heuristicaNoAgroFuerte(mensaje) {
  return (
    esProbableNoAgroDeportesOcio(mensaje) ||
    esActualidadGeopoliticaSinAnclaAgro(mensaje) ||
    esProbableConocimientoGeneralSinAgro(mensaje)
  );
}

async function llamarDominioJson({ clasificacion, mensaje, usuario, numeroWhatsapp, modoPrompt, historialPrecargado }) {
  let ultimas = [];
  if (Array.isArray(historialPrecargado) && historialPrecargado.length) {
    ultimas = historialPrecargado.slice(0, 5);
  } else {
    try {
      ultimas = await obtenerUltimasInteracciones({
        usuarioId: usuario?.id || null,
        whatsapp: numeroWhatsapp || null,
        /**
         * Subido 5 → 8 para mejor detección de "dominio del turno" en
         * conversaciones largas (carga multi-lote, planillas con varios
         * mensajes, seguimientos del estilo "y el resto?").
         */
        limite: 8,
      });
    } catch (_e) {
      ultimas = [];
    }
  }

  const int = String(clasificacion?.intencion || "");
  const userIa = [
    `Intención del clasificador (referencia interna; puede estar errada): \`${int}\``,
    construirPreguntaConHiloInterpretado(mensaje, ultimas, "duda"),
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
  const hibrido = dominioModoHibrido();
  const tieneIa = hayProveedorIa();

  if (hibrido) {
    if (esConsultaTimingMercadoAgro(mensaje)) {
      if (int === "no_agro" || int === "agro_general") {
        clasificacion.intencion = "analisis_mercado";
        if (!clasificacion.confianza) clasificacion.confianza = "media";
      }
      return { accion: "delegar", texto: null };
    }
    if (int === "no_agro") {
      pushAgentTurnTrace(clasificacion, {
        ok: true,
        via: "clasificador_no_agro",
        modo: "hibrido",
        emitioRepregunta: true,
      });
      return { accion: "repregunta_dominio", texto: REPREGUNTA_DOMINIO_FIJA };
    }
    if (heuristicaNoAgroFuerte(mensaje)) {
      pushAgentTurnTrace(clasificacion, {
        ok: true,
        via: "heuristica_local",
        modo: "hibrido",
        emitioRepregunta: true,
      });
      return { accion: "repregunta_dominio", texto: REPREGUNTA_DOMINIO_FIJA };
    }
    if (!tieneIa) {
      return { accion: "delegar", texto: null };
    }
  } else {
    if (!tieneIa) {
      if (esConsultaTimingMercadoAgro(mensaje) && (int === "no_agro" || int === "agro_general")) {
        clasificacion.intencion = "analisis_mercado";
        if (!clasificacion.confianza) clasificacion.confianza = "media";
      }
      if (int === "no_agro") {
        pushAgentTurnTrace(clasificacion, {
          ok: true,
          via: "sin_ia_clasificador_no_agro",
          modo: "solo_ia_fallback",
          emitioRepregunta: true,
        });
        return { accion: "repregunta_dominio", texto: REPREGUNTA_DOMINIO_FIJA };
      }
      if (heuristicaNoAgroFuerte(mensaje)) {
        pushAgentTurnTrace(clasificacion, {
          ok: true,
          via: "heuristica_fallback_sin_ia",
          modo: "solo_ia_fallback",
          emitioRepregunta: true,
        });
        return { accion: "repregunta_dominio", texto: REPREGUNTA_DOMINIO_FIJA };
      }
      return { accion: "delegar", texto: null };
    }
  }

  try {
    const modoPrompt = hibrido ? "hibrido" : "solo_ia";
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
