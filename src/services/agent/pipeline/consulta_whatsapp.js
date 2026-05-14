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

const debeSolicitarAclaracionIntencion = ({ textoPregunta, clasificacion }) => {
  if (
    ["0", "false", "off", "no"].includes(String(process.env.AGENT_CLASIFICADOR_REPREGUNTA_BAJA ?? "").trim().toLowerCase())
  ) {
    return false;
  }
  const t = String(textoPregunta || "").trim();
  if (!t || t.length > 220) return false;
  if (t.length <= 3 && /^(si|s[ií]|no|ok)$/i.test(t)) return false;
  if (/\d/.test(t)) return false;
  if (/^(mi|mis|ver|flete|alerta|avisame|reset\b|quiero\s+plan)/i.test(t)) return false;
  if (String(clasificacion?.intencion || "") === "comando") return false;
  if (String(clasificacion?.intencion || "") === "registrar") return false;
  try {
    const { esPreguntaMetaConversacional } = require("../../clasificador");
    if (esPreguntaMetaConversacional(t)) return false;
  } catch (_e) {
    /* seguimos */
  }
  const skip = new Set(["no_agro", "saludo", "small_talk"]);
  if (skip.has(String(clasificacion?.intencion || ""))) return false;
  return true;
};

/**
 * Preguntas catch-all que un agente jamás contestaría sin antes pedir
 * el objeto del pedido. Independiente de la confianza del clasificador
 * (a veces Gemini devuelve `media` con interpretación arbitraria y por
 * eso aterrizan en data-dumps como el reportado el 2026-05-12).
 *
 * Devuelve `string` con repregunta concreta o `null` si no aplica.
 * El llamador puede pasar `clasificacion` para evitar repreguntar en
 * seguimientos donde ya hay cultivo/tema en el historial.
 */
const detectarPreguntaAmbiguaCatchAll = (textoPregunta = "", clasificacion = null) => {
  const t = String(textoPregunta || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (!t || t.length > 60 || /\d/.test(t)) return null;
  /** Seguimientos detectados ya resuelven la ambigüedad por contexto. */
  if (clasificacion?._refuerzoSeguimientoHistorial) return null;
  /** "mercado" / "precio" / "cotización" a secas → ¿de qué? */
  if (/^(mercado|precios?|cotizacion(es)?|y\s+(el\s+)?mercado|hoy\s+(el\s+)?mercado)\??$/.test(t)) {
    if (String(clasificacion?.cultivo || "").trim()) return null;
    return [
      "¿De qué querés el precio o vista de mercado?",
      "Ej: *soja*, *maíz*, *trigo*, *novillo*, *dólar*, *insumos*…",
      "Mandámelo en una línea y lo busco.",
    ].join("\n");
  }
  /** "y con respecto al X" / "y respecto a X" → registrar vs consultar vs precio. */
  const mResp = t.match(
    /^y\s+(?:con\s+)?respecto\s+(?:a|al|del|de|a\s+(?:la|los|las))\s+(.+?)\s*\??$/
  );
  if (mResp) {
    const obj = mResp[1].slice(0, 40).trim();
    return [
      `¿Sobre *${obj}* qué necesitás?`,
      "▸ *Registrar* algo nuevo, *consultar* tus datos cargados, o ver *precio / análisis* de mercado.",
      "Decímelo concreto y lo respondo.",
    ].join("\n");
  }
  /** "y el X?" / "y la X?" sin verbo. */
  if (/^y\s+(el|la|los|las)\s+\w{3,}\s*\??$/.test(t)) {
    return "Decímelo más concreto: ¿qué necesitás saber/hacer? Una sola línea alcanza.";
  }
  /** "podés guardar todos|varios|juntos|a la vez" sin contenido. */
  if (
    /^pod[eé]s\s+(guardar|procesar|cargar|manejar)\s+(todo|todos|varios|muchos|juntos|a\s+la\s+vez)\b/.test(t) ||
    /^se\s+pueden?\s+(guardar|cargar|registrar)\s+(varios|todos|a\s+la\s+vez)/.test(t)
  ) {
    return [
      "Sí, podés mandarme varios en un solo mensaje 👌",
      "Pasame los datos (por ejemplo varios lotes con cantidades) y los cargo en orden.",
    ].join("\n");
  }
  return null;
};

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
   * Catch-all por regex (solo si `AGENT_IA_TOTAL=0`): p. ej. «mercado» a secas
   * o «Y con respecto al registro?». Con IA total (default ON) sigue el flujo
   * verify + dominio + scout + router.
   */
  if (!fusionPorAclaracionClasificador && !agentIaTotal()) {
    const repreguntaCatchAll = detectarPreguntaAmbiguaCatchAll(textoPregunta, clasificacion);
    if (repreguntaCatchAll) {
      try {
        await guardarEstado(waNorm, "agent_clasif_baja", "pendiente", { mensaje_original: textoPregunta }, 1);
      } catch (_e) {
        /* sin estado en BD: seguimos sin merge persistente */
      }
      logConsultaRoute(numeroWhatsapp, "aclaracion_catch_all", {
        cultivo: clasificacion.cultivo,
        confianza: clasificacion.confianza,
        msClasificador: Date.now() - t0,
      });
      await guardarConsulta({
        usuarioId: usuario?.id || null,
        whatsapp: waNorm,
        pregunta: textoPregunta,
        respuesta: repreguntaCatchAll,
        tokensUsados: null,
        iaProvider: "aclaracion_catch_all",
      });
      return repreguntaCatchAll;
    }
  }

  /**
   * Repregunta fija por confianza baja: desactivada con `AGENT_IA_TOTAL` (default ON).
   */
  if (
    !fusionPorAclaracionClasificador &&
    !agentIaTotal() &&
    clasificacion.confianza === "baja" &&
    debeSolicitarAclaracionIntencion({ textoPregunta, clasificacion })
  ) {
    try {
      await guardarEstado(waNorm, "agent_clasif_baja", "pendiente", { mensaje_original: textoPregunta }, 1);
    } catch (_e) {
      /* sin estado en BD: seguimos sin repregunta persistente */
    }
    const respuestaA = [
      "No estoy seguro de qué necesitás con ese mensaje 🤔",
      "¿Buscás *precio*, *clima*, *registrar* algo en el campo, *consultar tus datos* o *mercado / análisis*?",
      "Respondé en una sola línea (ej: «precio soja» o «¿llueve esta semana?»).",
    ].join("\n");
    logConsultaRoute(numeroWhatsapp, "clasificador_aclaracion", {
      cultivo: clasificacion.cultivo,
      confianza: "baja",
      msClasificador: Date.now() - t0,
    });
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: waNorm,
      pregunta: textoPregunta,
      respuesta: respuestaA,
      tokensUsados: null,
      iaProvider: "clasificador_aclaracion",
    });
    return respuestaA;
  }

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
