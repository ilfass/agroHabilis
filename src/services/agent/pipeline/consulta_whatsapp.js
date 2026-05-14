"use strict";

/**
 * Pipeline tipo agente para una consulta WhatsApp (post-comando-control en `consultas.js`).
 * Orden: inventario pendiente → clasificar (o placeholder si `clasificadorDeferidoAlBucleUnificado` / `AGENT_WHATSAPP_SOLO_AGENTE`) → diálogo hilo → gates → dominio (salvo defer o solo-agente) → bucle unificado con tools (`agent.clasificar`, `agent.invoke_router`, …) **o** scout + `routear` con OAV → persistencia. Con `AGENT_IA_TOTAL` (default ON) no hay catch-all regex ni repregunta fija por confianza baja antes del router.
 */

const { query } = require("../../../config/database");
const { guardarConsulta } = require("../../../models/consulta");
const { normalizarWhatsapp, obtenerPerfil } = require("../../../models/usuario");
const {
  clasificarMensaje,
  normalizarClasificacion,
} = require("../../clasificador");
const { routear } = require("../../router");
const { completarGeolocalizacionSiFalta, logConsultaRoute } = require("../../consultas/legacy_helpers");
const { fusionarIntencionPrecalculada } = require("../../consultas/intencion_precalculada");
const { obtenerPendiente } = require("../../inventario/core");
const { manejarInventarioWhatsapp } = require("../../inventario/whatsapp_flow");
const { evaluarHiloAntesDeRegistroOGasto } = require("../../dialogo_hilo_registro");
const { evaluarDominioTurnoAntesDeRouter } = require("../gates/dominio_turno");
const { obtenerUltimasInteracciones } = require("../../consultas/contexto");
const { invokeTool } = require("../tools");
const { runObserveActVerifyChain } = require("../plan/oav_chain");
const { ejecutarScoutToolLoop } = require("../ia/tool_loop_scout");
const { ejecutarTurnoUnificado, unifiedTurnLoopHabilitado, clasificadorDeferidoAlBucleUnificado } = require("../ia/unified_turn_loop");
const { toolFirstModeHabilitado, ejecutarToolFirstTurn } = require("../ia/tool_first_turn");
const { obtenerEstado, limpiarEstado, guardarEstado } = require("../../conversacion_estado");
const {
  clasificadorHistorialLimite,
  verifyRouterMaxAttempts,
  oavStepMaxAttemptsCap,
  agentIaTotal,
  soloAgenteWhatsappActivo,
} = require("../cursor_mode");

/** [OBSOLETO] Reemplazado por razonamiento del Agente. */
// const debeSolicitarAclaracionIntencion = ... (eliminado)

/**
 * [OBSOLETO] Reemplazado por razonamiento del Agente en tool_first_turn.
 * Preguntas catch-all que un agente jamás contestaría sin antes pedir
 * el objeto del pedido.
 */
/*
const detectarPreguntaAmbiguaCatchAll = (textoPregunta = "", clasificacion = null) => {
  // ... (eliminado por ser basado en regex/heurística)
  return null;
};
*/

const obtenerYCompletarPerfil = async (numeroWhatsapp) => {
  const inicial = await obtenerPerfil(numeroWhatsapp);
  const usuario = await completarGeolocalizacionSiFalta(inicial);
  if (!usuario?.id) {
    return usuario ? { ...usuario, tiene_datos: false } : null;
  }
  const r = await query(
    `
      SELECT (
        EXISTS (SELECT 1 FROM gastos WHERE usuario_id = $1 LIMIT 1)
        OR EXISTS (SELECT 1 FROM ventas WHERE usuario_id = $1 LIMIT 1)
        OR EXISTS (SELECT 1 FROM inventario_movimiento WHERE usuario_id = $1 LIMIT 1)
      ) AS ok
    `,
    [usuario.id]
  );
  return { ...usuario, tiene_datos: Boolean(r.rows[0]?.ok) };
};

const mergeIaProviderTrace = (dialogoHiloTrace, gateTracesMerged) => {
  const gates = gateTracesMerged.length ? gateTracesMerged : null;
  if (dialogoHiloTrace && gates) {
    const base = Array.isArray(dialogoHiloTrace) ? dialogoHiloTrace : [dialogoHiloTrace];
    return [...base, ...gates];
  }
  return dialogoHiloTrace || gates;
};

const resolverIaProviderLabel = (
  dialogoHiloTrace,
  agentUnifiedTurnTrace,
  agentTurnTrace,
  agentGateTrace,
  precioAgentTrace
) => {
  if (dialogoHiloTrace) return "dialogo_hilo";
  if (agentUnifiedTurnTrace?.length) return "agent_unified";
  if (agentTurnTrace?.length) return "agent_turn";
  if (agentGateTrace?.length) return "agent_gate";
  if (precioAgentTrace?.length) return "precio_agent";
  return null;
};

const buildIaProviderTraceFinal = (clasificacion, dialogoHiloTrace, gateTracesMerged) => {
  const merged = mergeIaProviderTrace(dialogoHiloTrace, gateTracesMerged);
  const plan = Array.isArray(clasificacion?.agentPlanTrace) ? clasificacion.agentPlanTrace : [];
  if (!plan.length) return merged;
  const block = { type: "agent_plan", steps: plan.slice(-40) };
  if (!merged) return [block];
  if (Array.isArray(merged)) return [block, ...merged];
  return [block, merged];
};

/**
 * @param {string} numeroWhatsapp
 * @param {string} pregunta
 * @param {{ intencionPrecalculada?: object }} [opciones] Si viene (p. ej. desde WhatsApp tras `detectarIntencionIA`), se fusiona con el clasificador; si no, solo clasificador + verify.
 */
const procesarConsulta = async (numeroWhatsapp, pregunta, opciones = {}) => {
  const textoPregunta = String(pregunta || "").trim();
  if (!textoPregunta) return "No recibí la consulta.";

  const usuario = await obtenerYCompletarPerfil(numeroWhatsapp);

  if (usuario?.id) {
    const pendInv = await obtenerPendiente(usuario.id);
    if (pendInv) {
      const inv = await manejarInventarioWhatsapp({
        texto: textoPregunta,
        usuarioId: usuario.id,
        numeroWhatsapp: normalizarWhatsapp(numeroWhatsapp),
      });
      if (inv?.manejado && inv.respuesta != null) {
        const respuestaInv = inv.respuesta;
        logConsultaRoute(numeroWhatsapp, "registrar_inventario_pendiente", {
          cultivo: null,
          confianza: "alta",
          msClasificador: 0,
        });
        await guardarConsulta({
          usuarioId: usuario.id,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: respuestaInv,
          tokensUsados: null,
        });
        return respuestaInv;
      }
    }
  }

  /**
   * Cargamos el historial reciente UNA sola vez por turno para inyectarlo a:
   *   1) clasificador (entender mensajes ambiguos como seguimientos),
   *   2) gates posteriores (vía `opciones.historialReciente`).
   * Si falla (DB caída), no rompemos el turno: seguimos sin contexto.
   */
  let historialReciente = [];
  try {
    /**
     * Filas de historial para clasificador y gates. Default 8; con
     * `AGENT_CURSOR_MODE=1` sube a 24 salvo override por
     * `AGENT_HISTORIAL_CLASIFICADOR_LIMITE` (ver `agent/cursor_mode.js`).
     */
    const limiteHistorial = clasificadorHistorialLimite();
    historialReciente = await obtenerUltimasInteracciones({
      usuarioId: usuario?.id ?? null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      limite: limiteHistorial,
    });
  } catch (_) {
    historialReciente = [];
  }

  const waNorm = normalizarWhatsapp(numeroWhatsapp);
  let fusionPorAclaracionClasificador = false;
  let textoTrabajo = textoPregunta;
  try {
    const st = await obtenerEstado(waNorm);
    if (st?.flujo === "agent_clasif_baja" && String(st?.paso || "") === "pendiente") {
      await limpiarEstado(waNorm);
      fusionPorAclaracionClasificador = true;
      const prev = String(st.contexto?.mensaje_original || "").trim().slice(0, 240);
      textoTrabajo = prev
        ? `${textoPregunta}\n\n(Aclaración del productor respecto del mensaje anterior poco claro: «${prev}».)`
        : textoPregunta;
    }
  } catch (_e) {
    /* seguimos sin merge */
  }

  const intencionPrecalculada =
    opciones?.intencionPrecalculada && typeof opciones.intencionPrecalculada === "object"
      ? opciones.intencionPrecalculada
      : null;

  const soloWa = soloAgenteWhatsappActivo();
  if (soloWa && !unifiedTurnLoopHabilitado()) {
    return [
      "Modo solo-agente WhatsApp (`AGENT_WHATSAPP_SOLO_AGENTE`) requiere `OPENROUTER_API_KEY` y el bucle unificado activo",
      "(p. ej. `AGENT_UNIFIED_TURN_LOOP=1` o modo agente). Revisá la configuración.",
    ].join(" ");
  }

  /**
   * ── Tool-first mode ──────────────────────────────────────────────────────
   * Activar: AGENT_TOOL_FIRST_MODE=1
   * El LLM actúa directamente como router usando domain.* tools.
   * Sin clasificador previo, sin switch de intenciones.
   * Si devuelve texto → respuesta final. Si falla → fallback al pipeline clásico.
   */
  if (toolFirstModeHabilitado()) {
    try {
      const tfResult = await ejecutarToolFirstTurn({
        usuario,
        numeroWhatsapp,
        mensaje: textoTrabajo,
        historialReciente,
      });
      if (String(tfResult?.texto || "").trim()) {
        const respuestaTF = String(tfResult.texto).trim();
        logConsultaRoute(numeroWhatsapp, tfResult.domainToolUsed || "tool_first_direct", {
          cultivo: null,
          confianza: "alta",
          msClasificador: 0,
          via: "tool_first",
        });
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: respuestaTF,
          tokensUsados: null,
          iaProvider: "tool_first",
          iaProviderTrace: tfResult.toolTrace?.length
            ? [{ type: "tool_first_trace", events: tfResult.toolTrace.slice(-20) }]
            : null,
        });
        return respuestaTF;
      }
      // Si no devolvió texto → fallback silencioso al pipeline clásico
      console.warn("[agent] tool_first_turn: sin respuesta, fallback a pipeline clásico");
    } catch (err) {
      console.warn("[agent] tool_first_turn error:", err?.message || err);
    }
  }

  const t0 = Date.now();
  let deferClasificador = clasificadorDeferidoAlBucleUnificado();
  let clasificacion;
  if (soloWa) {
    clasificacion = normalizarClasificacion({ intencion: "agro_general", confianza: "media" });
    if (intencionPrecalculada) {
      clasificacion = normalizarClasificacion(
        fusionarIntencionPrecalculada(clasificacion, intencionPrecalculada, textoTrabajo)
      );
    }
    deferClasificador = false;
  } else if (deferClasificador) {
    clasificacion = normalizarClasificacion({ intencion: "agro_general", confianza: "baja" });
    if (intencionPrecalculada) {
      clasificacion = normalizarClasificacion(
        fusionarIntencionPrecalculada(clasificacion, intencionPrecalculada, textoTrabajo)
      );
    }
  } else {
    clasificacion = await clasificarMensaje(textoTrabajo, usuario, { historial: historialReciente });
    clasificacion = normalizarClasificacion(
      intencionPrecalculada
        ? fusionarIntencionPrecalculada(clasificacion, intencionPrecalculada, textoTrabajo)
        : clasificacion
    );
  }

  const hiloReg = await evaluarHiloAntesDeRegistroOGasto({
    mensaje: textoPregunta,
    usuarioId: usuario?.id ?? null,
    usuario: usuario || null,
    numeroWhatsapp,
    clasificacion,
    historialPrecargado: historialReciente,
  });
  const dialogoHiloTrace = hiloReg?.debug?.trace || null;
  const dialogoHiloDecision = hiloReg?.debug?.decisionFinal || null;
  if (hiloReg?.earlyReturn && String(hiloReg.texto || "").trim()) {
    const respuestaHilo = String(hiloReg.texto).trim();
    logConsultaRoute(numeroWhatsapp, "dialogo_hilo_repregunta", {
      cultivo: clasificacion.cultivo,
      confianza: "media",
      msClasificador: Date.now() - t0,
      decision: dialogoHiloDecision?.tipo || null,
      motivo: dialogoHiloDecision?.motivo || null,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: respuestaHilo,
      tokensUsados: null,
      iaProvider: "dialogo_hilo",
      iaProviderTrace: dialogoHiloTrace,
    });
    return respuestaHilo;
  }
  if (hiloReg?.clasificacionPatch && typeof hiloReg.clasificacionPatch === "object") {
    clasificacion = normalizarClasificacion({
      ...clasificacion,
      ...hiloReg.clasificacionPatch,
    });
  }

  /**
   * [OBSOLETO] Catch-all por regex y repregunta fija.
   * Se comenta para dar mayor participación a la IA en modo Agente.
   */
  /*
  if (!fusionPorAclaracionClasificador && !agentIaTotal()) {
    const repreguntaCatchAll = detectarPreguntaAmbiguaCatchAll(textoPregunta, clasificacion);
    // ...
  }
  */

  await invokeTool(
    "agent.turn_step",
    {
      step: "post_clasificador",
      detail: {
        intencion: clasificacion.intencion,
        confianza: clasificacion.confianza,
        cultivo: clasificacion.cultivo,
      },
    },
    { clasificacion }
  );

  const omitirDominioAntesRouter = deferClasificador || soloWa;
  let dominioTurno = { accion: "delegar", texto: null };
  if (!omitirDominioAntesRouter) {
    dominioTurno = await evaluarDominioTurnoAntesDeRouter({
      clasificacion,
      mensaje: textoTrabajo,
      usuario,
      numeroWhatsapp,
      historialPrecargado: historialReciente,
    });
  }
  if (dominioTurno.accion === "repregunta_dominio" && String(dominioTurno.texto || "").trim()) {
    const respuestaDominio = String(dominioTurno.texto).trim();
    logConsultaRoute(numeroWhatsapp, "agent_turn_dominio", {
      cultivo: clasificacion.cultivo,
      confianza: clasificacion.confianza,
      msClasificador: Date.now() - t0,
    });
    const agentTurnTraceOnly = Array.isArray(clasificacion?.agentTurnTrace)
      ? clasificacion.agentTurnTrace
      : null;
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: respuestaDominio,
      tokensUsados: null,
      iaProvider: agentTurnTraceOnly?.length ? "agent_turn" : null,
      iaProviderTrace: agentTurnTraceOnly,
    });
    return respuestaDominio;
  }

  if (!deferClasificador && !soloWa) {
    await invokeTool(
      "agent.turn_step",
      { step: "post_dominio", detail: { intencion: clasificacion.intencion } },
      { clasificacion }
    );

    logConsultaRoute(numeroWhatsapp, clasificacion.intencion, {
      cultivo: clasificacion.cultivo,
      confianza: clasificacion.confianza,
      msClasificador: Date.now() - t0,
    });
  }

  await invokeTool("agent.turn_step", { step: "pre_router" }, { clasificacion });

  try {
    if (!unifiedTurnLoopHabilitado()) {
      const scout = await ejecutarScoutToolLoop({
        clasificacion,
        usuario,
        numeroWhatsapp,
        mensaje: textoTrabajo,
      });
      if (scout?.resumen && String(scout.resumen).trim()) {
        clasificacion.agentScoutContext = String(scout.resumen).trim();
      }
      if (scout?.toolTrace?.length) {
        await invokeTool(
          "agent.turn_step",
          { step: "scout_tool_loop", detail: { eventos: scout.toolTrace.length } },
          { clasificacion }
        );
      }
    }
  } catch (e) {
    console.warn("[agent] scout tool loop:", e?.message || e);
  }

  const maxRouterAttempts = Math.min(oavStepMaxAttemptsCap(), verifyRouterMaxAttempts());

  const respuesta = await runObserveActVerifyChain({
    ctx: { clasificacion },
    steps: [
      {
        name: "router",
        maxAttempts: maxRouterAttempts,
        act: async ({ attempt }) => {
          let needClasificarFallback = false;
          if (attempt === 1 && unifiedTurnLoopHabilitado()) {
            try {
              const uni = await ejecutarTurnoUnificado({
                clasificacion,
                usuario,
                numeroWhatsapp,
                mensaje: textoTrabajo,
                deferClasificador,
                soloAgenteWhatsapp: soloWa,
                historialReciente,
                intencionPrecalculada,
              });
              if (Array.isArray(uni?.toolTrace)) {
                clasificacion.agentUnifiedTurnTrace = uni.toolTrace;
              }
              if (uni?.toolTrace?.length) {
                await invokeTool(
                  "agent.turn_step",
                  {
                    step: "unified_tool_loop",
                    detail: {
                      eventos: uni.toolTrace.length,
                      usedInvokeRouter: Boolean(uni.usedInvokeRouter),
                    },
                  },
                  { clasificacion }
                );
              }
              if (String(uni?.texto || "").trim()) {
                return String(uni.texto).trim();
              }
              needClasificarFallback = Boolean(deferClasificador) && !soloWa;
            } catch (err) {
              console.warn("[agent] unified turn loop:", err?.message || err);
              needClasificarFallback = Boolean(deferClasificador) && !soloWa;
            }
          }
          if ((attempt > 1 && deferClasificador && !soloWa) || needClasificarFallback) {
            try {
              await invokeTool(
                "agent.clasificar",
                {},
                {
                  clasificacion,
                  usuario,
                  numeroWhatsapp,
                  mensaje: textoTrabajo,
                  historialReciente,
                  intencionPrecalculada,
                }
              );
            } catch (_e) {
              /* seguimos con routear */
            }
          }
          if (attempt > 1) {
            await invokeTool("agent.turn_step", { step: "router_reintento", detail: { attempt } }, { clasificacion });
          }
          return routear({
            clasificacion,
            mensaje: textoTrabajo,
            usuario,
            numeroWhatsapp,
          });
        },
        verify: (out) => ({
          ok: typeof out === "string" && out.trim().length >= 2,
        }),
      },
    ],
  });

  if (deferClasificador || soloWa) {
    await invokeTool(
      "agent.turn_step",
      {
        step: "post_dominio",
        detail: { intencion: clasificacion.intencion, deferred: Boolean(deferClasificador), soloAgente: soloWa },
      },
      { clasificacion }
    );
    logConsultaRoute(numeroWhatsapp, clasificacion.intencion, {
      cultivo: clasificacion.cultivo,
      confianza: clasificacion.confianza,
      msClasificador: Date.now() - t0,
    });
  }

  await invokeTool(
    "agent.turn_step",
    { step: "post_router", detail: { len: typeof respuesta === "string" ? respuesta.length : 0 } },
    { clasificacion }
  );

  const agentUnifiedTurnTrace = Array.isArray(clasificacion?.agentUnifiedTurnTrace)
    ? clasificacion.agentUnifiedTurnTrace
    : null;
  const agentGateTrace = Array.isArray(clasificacion?.agentGateTrace) ? clasificacion.agentGateTrace : null;
  const precioAgentTrace = Array.isArray(clasificacion?.precioAgentTrace)
    ? clasificacion.precioAgentTrace
    : null;
  const agentTurnTrace = Array.isArray(clasificacion?.agentTurnTrace) ? clasificacion.agentTurnTrace : null;
  const gateTracesMerged = [
    ...(agentUnifiedTurnTrace?.length
      ? [{ type: "agent_unified_turn", events: agentUnifiedTurnTrace.slice(-48) }]
      : []),
    ...(agentTurnTrace || []),
    ...(agentGateTrace || []),
    ...(precioAgentTrace || []),
  ];

  await guardarConsulta({
    usuarioId: usuario?.id || null,
    whatsapp: normalizarWhatsapp(numeroWhatsapp),
    pregunta: textoPregunta,
    respuesta,
    tokensUsados: null,
    iaProvider: resolverIaProviderLabel(
      dialogoHiloTrace,
      agentUnifiedTurnTrace,
      agentTurnTrace,
      agentGateTrace,
      precioAgentTrace
    ),
    iaProviderTrace: buildIaProviderTraceFinal(clasificacion, dialogoHiloTrace, gateTracesMerged),
  });

  return respuesta;
};

procesarConsulta.obtenerYCompletarPerfil = obtenerYCompletarPerfil;

module.exports = {
  obtenerYCompletarPerfil,
  procesarConsulta,
  detectarPreguntaAmbiguaCatchAll,
  debeSolicitarAclaracionIntencion,
};
