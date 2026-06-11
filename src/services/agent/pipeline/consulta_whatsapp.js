"use strict";

/**
 * Pipeline tipo agente para una consulta WhatsApp (post-comando-control en `consultas.js`).
 * Orden: inventario pendiente → clasificar (o placeholder si `clasificadorDeferidoAlBucleUnificado` / `AGENT_WHATSAPP_SOLO_AGENTE`) → diálogo hilo → gates → dominio (salvo defer o solo-agente) → bucle unificado con tools (`agent.clasificar`, `agent.invoke_router`, …) **o** scout + `routear` con OAV → persistencia. Con `AGENT_IA_TOTAL` (default ON) no hay catch-all regex ni repregunta fija por confianza baja antes del router.
 */

const { query } = require("../../../config/database");
const { guardarConsulta } = require("../../../models/consulta");
const { normalizarWhatsapp, obtenerPerfil } = require("../../../models/usuario");
const { iaRequestContext } = require("../../gemini_keys");
const {
  clasificarMensaje,
  normalizarClasificacion,
} = require("../../clasificador");
const {
  esSaludoSocialCorto,
  textoParaClasificacionSaludo,
} = require("../../intent_classifier");
const { routear } = require("../../router");
const { completarGeolocalizacionSiFalta, logConsultaRoute } = require("../../consultas/legacy_helpers");
const { fusionarIntencionPrecalculada } = require("../../consultas/intencion_precalculada");
const { obtenerPendiente } = require("../../inventario/core");
const { manejarInventarioWhatsapp } = require("../../inventario/whatsapp_flow");
const {
  esPlanoCatastral,
  procesarPlanoCatastral,
  manejarConfirmacionLotesPlano,
  FLUJO: FLUJO_LOTES_PLANO,
  PASO_ESPERANDO: PASO_LOTES_PLANO,
} = require("../../turn_handlers/lotes_plano_handler");
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

const obtenerYCompletarPerfil = async (numeroWhatsapp, numeroRealOptional) => {
  const inicial = await obtenerPerfil(numeroWhatsapp, numeroRealOptional);
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

const PREGUNTA_MARCADOR_BROADCAST =
  "[AgroHabilis — mensaje del equipo por WhatsApp; no ingresó una consulta del productor. Las respuestas siguientes suelen ser feedback a esta campaña (aunque antes haya ido un recordatorio corto, p. ej. solo un saludo con el nombre).]";

/**
 * @param {string} numeroWhatsapp
 * @param {string} pregunta
 * @param {{ intencionPrecalculada?: object, numeroReal?: string }} [opciones] Si viene (p. ej. desde WhatsApp tras `detectarIntencionIA`), se fusiona con el clasificador; si no, solo clasificador + verify.
 */
const detectarMensajeAmbiguoStock = (mensaje = "", perfil = null) => {
  const texto = String(mensaje || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  if (texto.length > 80) return null;
  
  const tieneNumero = /\b\d+\b/.test(texto);
  if (!tieneNumero) return null;
  
  const palabrasClave = [
    "vaca", "vacas", "novillo", "novillos", "ternero", "terneros", 
    "toro", "toros", "vaquillona", "vaquillonas", "cabezas", "cab", "rodeo",
    "soja", "maiz", "maíz", "trigo", "cebada", "girasol", "sorgo",
    "urea", "fertilizante", "fosfato", "glifosato", "insumo", "insumos",
    "hectarea", "hectareas", "ha", "tonelada", "toneladas", "tn", "kg", "kilos"
  ].map(p => p.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

  const tienePalabraClave = palabrasClave.some(palabra => new RegExp(`\\b${palabra}\\b`, "i").test(texto));
  if (!tienePalabraClave) return null;
  
  const verbosAccion = [
    "cargar", "cargá", "cargas", "cargue", "cargamos", "anotar", "anotá", "anoté", "anote", "anotamos",
    "registrar", "registrá", "registre", "registramos", "guardar", "guardá", "guarde", "guardamos",
    "aplicar", "apliqué", "aplique", "aplicamos", "sembrar", "sembré", "sembre", "sembramos",
    "cosechar", "coseché", "coseche", "cosechamos", "comprar", "compré", "compre", "compramos",
    "vender", "vendí", "vendi", "vendemos", "gastar", "gasté", "gaste", "gastamos",
    "precio", "precios", "cotizar", "cotizacion", "cotización", "cuanto", "cuánto", "vale", "valen",
    "alerta", "alertas", "avisame", "avísame", "ver", "mostrar", "resumen", "flete", "fletes",
    "trasladar", "traslado", "mover", "movimiento", "eliminar", "borrar",
    "lote", "corral", "campo", "potrero", "establecimiento"
  ].map(v => v.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

  const tieneAccion = verbosAccion.some(accion => new RegExp(`\\b${accion}\\b`, "i").test(texto));
  if (tieneAccion) return null;
  
  const numeroMatch = texto.match(/\b\d+\b/);
  const numero = numeroMatch ? numeroMatch[0] : "";
  
  const entidadCoincidente = palabrasClave.find(palabra => new RegExp(`\\b${palabra}\\b`, "i").test(texto)) || "animales";
  
  let entidadAmigable = entidadCoincidente;
  if (entidadCoincidente === "vaca") entidadAmigable = "vacas";
  else if (entidadCoincidente === "novillo") entidadAmigable = "novillos";
  else if (entidadCoincidente === "ternero") entidadAmigable = "terneros";
  
  const nombre = perfil?.nombre ? String(perfil.nombre).split(" ")[0].trim() : "";
  const saludo = nombre ? `¡Hola ${nombre}! ` : "¡Hola! ";
  
  return `${saludo}Mencionás *${numero} ${entidadAmigable}*. ¿Querés que las **registre** en tu inventario o estás queriendo consultar la **cotización** de mercado de hoy?`;
};

const procesarConsulta = async (numeroWhatsapp, pregunta, opciones = {}) => {
  const store = { providerUsed: null, providerTrace: [] };
  return iaRequestContext.run(store, async () => {
    const textoPregunta = String(pregunta || "").trim();
    if (!textoPregunta) return "No recibí la consulta.";

    const usuario = await obtenerYCompletarPerfil(numeroWhatsapp, opciones.numeroReal);

  if (usuario?.id) {
    const ambig = detectarMensajeAmbiguoStock(textoPregunta, usuario);
    if (ambig) {
      logConsultaRoute(numeroWhatsapp, "repregunta_ambiguedad_stock_determinista", {
        cultivo: null,
        confianza: "alta",
        msClasificador: 0,
      });
      await guardarConsulta({
        usuarioId: usuario.id,
        whatsapp: normalizarWhatsapp(numeroWhatsapp),
        pregunta: textoPregunta,
        respuesta: ambig,
        tokensUsados: 0,
      });
      return ambig;
    }

    // Intercepción directa de planillas de siembra / carga multi-lote visuales (OCR)
    const esPlanillaOcr = textoPregunta.includes("[Análisis de archivo:") && 
      (textoPregunta.toLowerCase().includes("planilla") || 
       textoPregunta.toLowerCase().includes("tabla") || 
       textoPregunta.toLowerCase().includes("columnas") ||
       textoPregunta.toLowerCase().includes("siembra de fina") ||
       textoPregunta.toLowerCase().includes("siembra de gruesa") ||
       textoPregunta.toLowerCase().includes("observaciones:"));

    if (esPlanillaOcr) {
      const inv = await manejarInventarioWhatsapp({
        texto: textoPregunta,
        usuarioId: usuario.id,
        numeroWhatsapp: normalizarWhatsapp(numeroWhatsapp),
      });
      if (inv?.manejado && inv.respuesta != null) {
        const respuestaInv = inv.respuesta;
        logConsultaRoute(numeroWhatsapp, "registrar_planilla_ocr_directo", {
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

    // ── Intercepción de plano catastral (foto/PDF con lista de lotes/potreros) ──
    if (esPlanoCatastral(textoPregunta)) {
      const resultadoPlano = await procesarPlanoCatastral({
        textoOcr: textoPregunta,
        usuarioId: usuario.id,
        numeroWhatsapp: normalizarWhatsapp(numeroWhatsapp),
        nombreUsuario: usuario.nombre || null,
      });
      if (resultadoPlano?.manejado && resultadoPlano.respuesta != null) {
        logConsultaRoute(numeroWhatsapp, "plano_catastral_lista_lotes", {
          cultivo: null,
          confianza: "alta",
          msClasificador: 0,
        });
        await guardarConsulta({
          usuarioId: usuario.id,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: resultadoPlano.respuesta,
          tokensUsados: null,
        });
        return resultadoPlano.respuesta;
      }
    }

    // ── Confirmación de lotes de plano catastral pendientes ──
    const waCleanCheck = normalizarWhatsapp(numeroWhatsapp);
    let estadoLotesPlano = null;
    try {
      const st = await obtenerEstado(waCleanCheck);
      if (st?.flujo === FLUJO_LOTES_PLANO && st?.paso === PASO_LOTES_PLANO) {
        estadoLotesPlano = st;
      }
    } catch (_) { /* seguimos sin estado */ }

    if (estadoLotesPlano) {
      const resultadoConfirmacion = await manejarConfirmacionLotesPlano({
        textoPregunta,
        estadoPlano: estadoLotesPlano,
        usuarioId: usuario.id,
        numeroWhatsapp: normalizarWhatsapp(numeroWhatsapp),
        nombreUsuario: usuario.nombre || null,
      });
      if (resultadoConfirmacion?.manejado && resultadoConfirmacion.respuesta != null) {
        logConsultaRoute(numeroWhatsapp, "lotes_plano_confirmacion", {
          cultivo: null,
          confianza: "alta",
          msClasificador: 0,
        });
        await guardarConsulta({
          usuarioId: usuario.id,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: resultadoConfirmacion.respuesta,
          tokensUsados: null,
        });
        return resultadoConfirmacion.respuesta;
      }
    }

    const pendInv = await obtenerPendiente(usuario.id);
    if (pendInv) {
      const t = String(textoPregunta || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      const esOtroDominio = 
        /\b(precio|cotizacion|valor|pizarra|mercado|d[oó]lar|dolar|euro|insumo|fertilizante|herbicida|semilla|flete)\b/.test(t) ||
        /\b(clima|llueve|llover|llovi[oó]|temperatura|pron[oó]stico|helada|granizo|viento)\b/.test(t) ||
        /\b(mi\s+resumen|mis\s+alertas|mi\s+margen|mis\s+ventas|mis\s+gastos|ver\s+comandos|planes)\b/.test(t) ||
        /\b(sos\s+(un\s+)?(agente|bot)|qu[eé]\s+(es|hace|sos))\b/.test(t) ||
        /\b(crear|dar\s+de\s+alta|nuevo|registrar)\s+(lote|lotes|campo|campos|potrero|potreros|firma)\b/.test(t);
      const esCancelar = /\b(cancelar|cancela|cancelemos|olvidalo|olvidate|dejalo|dejemos|no\s+lo\s+guardes|no\s+importa)\b/.test(t);

      if (esCancelar || !esOtroDominio) {
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
      usuarioId: usuario?.es_delegado ? null : (usuario?.id ?? null),
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

  // ── Enrutador Híbrido Determinista (NLU + Backend + Humanización) ──
  if (intencionPrecalculada && intencionPrecalculada.tipo) {
    const intent = intencionPrecalculada.tipo;
    const parametros = intencionPrecalculada.parametros || {};

    if (
      intent === "clima" ||
      intent === "precio" ||
      intent === "consulta_registros" ||
      (intent === "comando" && (
        intencionPrecalculada.comando === "REGISTRAR_GASTO" ||
        intencionPrecalculada.comando === "REGISTRAR_VENTA" ||
        intencionPrecalculada.comando === "CREAR_ALERTA" ||
        intencionPrecalculada.comando === "MI_RESUMEN" ||
        intencionPrecalculada.comando === "MIS_ALERTAS" ||
        intencionPrecalculada.comando === "MI_MARGEN" ||
        intencionPrecalculada.comando === "PLANES"
      ))
    ) {
      console.log(`[Hybrid Router] Interceptando intención '${intent}' / comando '${intencionPrecalculada.comando || "N/A"}' de forma determinista.`);

      let rawResult = null;
      let handled = false;

      const toolCtx = {
        clasificacion: { intencion: intent, confianza: "alta" },
        usuario: usuario || null,
        numeroWhatsapp,
        mensaje: textoTrabajo,
        historialReciente: Array.isArray(historialReciente) ? historialReciente : [],
      };

      try {
        if (intent === "clima") {
          const res = await invokeTool("domain.get_weather", {
            zona: parametros.zona || null,
            periodo: parametros.periodo || null
          }, toolCtx);
          if (res.ok) {
            rawResult = res.result?.texto || "";
            handled = true;
          }
        } else if (intent === "precio") {
          let variante = null;
          if (parametros.producto === "hacienda") variante = "hacienda";
          else if (parametros.producto === "insumo") variante = "insumos";
          else if (parametros.variante_precio === "dolar") variante = "dolar";

          const res = await invokeTool("domain.get_prices", {
            cultivo: parametros.cultivo || null,
            variante
          }, toolCtx);
          if (res.ok) {
            rawResult = res.result?.texto || "";
            handled = true;
          }
        } else if (intent === "consulta_registros") {
          const res = await invokeTool("domain.get_records", {
            tipo: parametros.concepto || "todo"
          }, toolCtx);
          if (res.ok) {
            rawResult = res.result?.texto || "";
            handled = true;
          }
        } else if (intent === "comando" && (intencionPrecalculada.comando === "REGISTRAR_GASTO" || intencionPrecalculada.comando === "REGISTRAR_VENTA")) {
          const { registrarGasto, registrarVenta } = require("../../gastos");
          if (intencionPrecalculada.comando === "REGISTRAR_GASTO" && parametros.monto) {
            rawResult = await registrarGasto(usuario || numeroWhatsapp, textoTrabajo, {
              perfil: parametros.producto === "hacienda" ? "ganaderia" : "agricultura",
              categoria: parametros.concepto || "otro",
              descripcion: parametros.concepto || "gasto",
              monto: parametros.monto,
              fecha: new Date().toISOString().slice(0, 10)
            });
            handled = true;
          } else if (intencionPrecalculada.comando === "REGISTRAR_VENTA" && parametros.cantidad) {
            rawResult = await registrarVenta(usuario || numeroWhatsapp, textoTrabajo, {
              perfil: parametros.cultivo ? "agricultura" : "ganaderia",
              producto: parametros.cultivo || "venta",
              cantidad: parametros.cantidad,
              unidad: parametros.unidad || "tn",
              monto_total: parametros.monto || 0,
              precio_unitario: parametros.monto && parametros.cantidad ? Number((parametros.monto / parametros.cantidad).toFixed(2)) : 0,
              fecha: new Date().toISOString().slice(0, 10)
            });
            handled = true;
          }
        } else if (intent === "comando" && intencionPrecalculada.comando) {
          const res = await invokeTool("domain.run_command", {
            comando: intencionPrecalculada.comando
          }, toolCtx);
          if (res.ok) {
            rawResult = res.result?.texto || "";
            handled = true;
          }
        }

        if (handled && rawResult) {
          let respuestaFinal = rawResult;

          // Humanizar los datos técnicos para consultas dinámicas
          if (["clima", "precio", "consulta_registros"].includes(intent)) {
            try {
              const { humanizarRespuesta } = require("../ia/humanizer");
              respuestaFinal = await humanizarRespuesta({
                mensajeOriginal: textoTrabajo,
                datosCrudos: rawResult,
                usuario
              });
            } catch (err) {
              console.warn("[Hybrid Router] Error al humanizar:", err.message);
            }
          }

          // Registrar en la base de datos de consultas
          await guardarConsulta({
            usuarioId: usuario?.id || null,
            whatsapp: normalizarWhatsapp(numeroWhatsapp),
            pregunta: textoPregunta,
            respuesta: respuestaFinal,
            tokensUsados: null,
            iaProvider: "hybrid_router",
            iaProviderTrace: [
              { type: "hybrid_router_nlu", intent, parameters: parametros }
            ]
          });

          return respuestaFinal;
        }
      } catch (err) {
        console.warn("[Hybrid Router] Error ejecutando atajo híbrido, continuando con pipeline clásico:", err.message);
      }
    }
  }

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
  let esSaludo = false;
  try {
    const usuarioSaludoSolo = textoParaClasificacionSaludo(textoTrabajo);
    esSaludo = esSaludoSocialCorto(usuarioSaludoSolo);
  } catch (e) {
    console.warn("[consulta_whatsapp] Error checking esSaludo in pipeline:", e.message);
  }

  let ultimoEsBroadcast = false;
  if (usuario?.id) {
    try {
      const waNorm = normalizarWhatsapp(numeroWhatsapp);
      const ult = await query(
        `SELECT pregunta 
         FROM historial_consultas 
         WHERE (usuario_id = $1 AND usuario_id IS NOT NULL) OR whatsapp = $2 
         ORDER BY creado_en DESC 
         LIMIT 1`,
        [usuario.id, waNorm]
      );
      if (ult.rows[0] && ult.rows[0].pregunta === PREGUNTA_MARCADOR_BROADCAST) {
        ultimoEsBroadcast = true;
      }
    } catch (e) {
      console.warn("[consulta_whatsapp] Error checking last broadcast in pipeline:", e.message);
    }
  }

  if (toolFirstModeHabilitado() && !esSaludo && !ultimoEsBroadcast) {
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
        const activeStore = iaRequestContext.getStore() || {};
        await guardarConsulta({
          usuarioId: usuario?.id || null,
          whatsapp: normalizarWhatsapp(numeroWhatsapp),
          pregunta: textoPregunta,
          respuesta: respuestaTF,
          tokensUsados: null,
          iaProvider: activeStore.providerUsed || "tool_first",
          iaProviderTrace: [
            ...(activeStore.providerTrace || []),
            ...(tfResult.toolTrace?.length
              ? [{ type: "tool_first_trace", events: tfResult.toolTrace.slice(-20) }]
              : [])
          ],
        });
        return respuestaTF;
      }
      // Si no devolvió texto → fallback silencioso al pipeline clásico
      const errorEnTrace = tfResult?.toolTrace?.some((t) => t.error);
      const isCorto = String(textoTrabajo || "").trim().length < 60;
      const hayHistorial = Array.isArray(historialReciente) && historialReciente.length > 0;
      
      if (errorEnTrace && isCorto && hayHistorial) {
        console.warn("[agent] tool_first_turn falló por API en un turno conversacional corto. Abortando fallback a agro_general para evitar alucinaciones.");
        return "Disculpá, estoy teniendo una demora técnica para procesar esa respuesta. ¿Podemos reintentar o me lo decís de otra forma?";
      }

      console.warn("[agent] tool_first_turn: sin respuesta, fallback a pipeline clásico");
    } catch (err) {
      console.warn("[agent] tool_first_turn error:", err?.message || err);
      const isCorto = String(textoTrabajo || "").trim().length < 60;
      const hayHistorial = Array.isArray(historialReciente) && historialReciente.length > 0;
      if (isCorto && hayHistorial) {
        return "Disculpá, estoy teniendo una demora técnica. ¿Podemos reintentar en un minuto?";
      }
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
    const activeStore = iaRequestContext.getStore() || {};
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: respuestaHilo,
      tokensUsados: null,
      iaProvider: activeStore.providerUsed || "dialogo_hilo",
      iaProviderTrace: [
        ...(activeStore.providerTrace || []),
        ...(dialogoHiloTrace ? (Array.isArray(dialogoHiloTrace) ? dialogoHiloTrace : [dialogoHiloTrace]) : [])
      ],
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
    const activeStore = iaRequestContext.getStore() || {};
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta: respuestaDominio,
      tokensUsados: null,
      iaProvider: activeStore.providerUsed || (agentTurnTraceOnly?.length ? "agent_turn" : null),
      iaProviderTrace: [...(activeStore.providerTrace || []), ...(agentTurnTraceOnly || [])],
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
            historialReciente,
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

    const activeStore = iaRequestContext.getStore() || {};
    await guardarConsulta({
      usuarioId: usuario?.id || null,
      whatsapp: normalizarWhatsapp(numeroWhatsapp),
      pregunta: textoPregunta,
      respuesta,
      tokensUsados: null,
      iaProvider: activeStore.providerUsed || resolverIaProviderLabel(
        dialogoHiloTrace,
        agentUnifiedTurnTrace,
        agentTurnTrace,
        agentGateTrace,
        precioAgentTrace
      ),
      iaProviderTrace: buildIaProviderTraceFinal(
        clasificacion,
        dialogoHiloTrace,
        [...(activeStore.providerTrace || []), ...gateTracesMerged]
      ),
    });

    return respuesta;
  });
};

procesarConsulta.obtenerYCompletarPerfil = obtenerYCompletarPerfil;

module.exports = {
  obtenerYCompletarPerfil,
  procesarConsulta,
};
