"use strict";

/**
 * Pipeline tipo agente para una consulta WhatsApp (post-comando-control en `consultas.js`).
 * Orden: inventario pendiente → clasificar → refuerzo inventario → diálogo hilo registro → gate dominio → **scout opcional (tool-calling OpenRouter)** → pasos del plan (`agent/tools`) → **cadena OAV** (`runObserveActVerifyChain`: hoy un paso `router` con verify/retry) → persistencia.
 */

const { query } = require("../../../config/database");
const { guardarConsulta } = require("../../../models/consulta");
const { normalizarWhatsapp, obtenerPerfil } = require("../../../models/usuario");
const {
  clasificarMensaje,
  normalizarClasificacion,
  aplicarRefuerzoRegistroInventario,
  aplicarRefuerzoSeguimientoHistorial,
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

const resolverIaProviderLabel = (dialogoHiloTrace, agentTurnTrace, agentGateTrace, precioAgentTrace) => {
  if (dialogoHiloTrace) return "dialogo_hilo";
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
 * @param {{ intencionPrecalculada?: unknown }} [opciones]
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
     * Cap del historial para el clasificador y gates. Subido de 4 → 8
     * (override por env) para casos como cargar varios lotes seguidos
     * o seguimientos largos ("Y el resto?", "podés procesar varios?",
     * "los demás también"). Un agente debe poder hilar más turnos.
     */
    const limiteHistorial = Math.max(
      1,
      Math.min(
        12,
        Number.parseInt(String(process.env.AGENT_HISTORIAL_CLASIFICADOR_LIMITE || "8"), 10) || 8
      )
    );
    historialReciente = await obtenerUltimasInteracciones({
      usuarioId: usuario?.id ?? null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      limite: limiteHistorial,
    });
  } catch (_) {
    historialReciente = [];
  }

  const t0 = Date.now();
  let clasificacion = await clasificarMensaje(textoPregunta, usuario, { historial: historialReciente });
  if (opciones?.intencionPrecalculada) {
    clasificacion = normalizarClasificacion(
      fusionarIntencionPrecalculada(clasificacion, opciones.intencionPrecalculada, textoPregunta)
    );
  }
  clasificacion = aplicarRefuerzoRegistroInventario(textoPregunta, clasificacion);
  clasificacion = aplicarRefuerzoSeguimientoHistorial(textoPregunta, clasificacion, historialReciente);

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

  const dominioTurno = await evaluarDominioTurnoAntesDeRouter({
    clasificacion,
    mensaje: textoPregunta,
    usuario,
    numeroWhatsapp,
    historialPrecargado: historialReciente,
  });
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

  await invokeTool("agent.turn_step", { step: "pre_router" }, { clasificacion });

  try {
    const scout = await ejecutarScoutToolLoop({
      clasificacion,
      usuario,
      numeroWhatsapp,
      mensaje: textoPregunta,
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
  } catch (e) {
    console.warn("[agent] scout tool loop:", e?.message || e);
  }

  const maxRouterAttempts = Math.min(
    4,
    Math.max(1, Number.parseInt(String(process.env.AGENT_VERIFY_ROUTER_MAX || "2"), 10) || 2)
  );

  const respuesta = await runObserveActVerifyChain({
    ctx: { clasificacion },
    steps: [
      {
        name: "router",
        maxAttempts: maxRouterAttempts,
        act: async ({ attempt }) => {
          if (attempt > 1) {
            await invokeTool("agent.turn_step", { step: "router_reintento", detail: { attempt } }, { clasificacion });
          }
          return routear({
            clasificacion,
            mensaje: textoPregunta,
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

  await invokeTool(
    "agent.turn_step",
    { step: "post_router", detail: { len: typeof respuesta === "string" ? respuesta.length : 0 } },
    { clasificacion }
  );

  const agentGateTrace = Array.isArray(clasificacion?.agentGateTrace) ? clasificacion.agentGateTrace : null;
  const precioAgentTrace = Array.isArray(clasificacion?.precioAgentTrace)
    ? clasificacion.precioAgentTrace
    : null;
  const agentTurnTrace = Array.isArray(clasificacion?.agentTurnTrace) ? clasificacion.agentTurnTrace : null;
  const gateTracesMerged = [
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
    iaProvider: resolverIaProviderLabel(dialogoHiloTrace, agentTurnTrace, agentGateTrace, precioAgentTrace),
    iaProviderTrace: buildIaProviderTraceFinal(clasificacion, dialogoHiloTrace, gateTracesMerged),
  });

  return respuesta;
};

procesarConsulta.obtenerYCompletarPerfil = obtenerYCompletarPerfil;

module.exports = {
  obtenerYCompletarPerfil,
  procesarConsulta,
};
