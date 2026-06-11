"use strict";

/**
 * Un solo bucle OpenRouter con tools (incluye `agent.invoke_router` para cerrar con el motor interno).
 * Reemplaza el par scout + `routear` directo cuando `unifiedTurnLoopHabilitado()` (OpenRouter + modo agente o `AGENT_UNIFIED_TURN_LOOP=1`).
 */

const { invokeTool, listTools } = require("../tools");
const { postOpenRouterChat, parseToolArgs, toOpenAiToolDefinitions } = require("./openrouter_chat");
const { envTruthy } = require("./tool_loop_scout");
const { scoutMaxTurns, scoutMaxToolCalls, cursorMode, defaultOnUnlessOff } = require("../cursor_mode");
const { evaluarDominioTurnoAntesDeRouter } = require("../gates/dominio_turno");

/**
 * ON si hay OpenRouter y no está explícitamente apagado.
 * Si `AGENT_UNIFIED_TURN_LOOP` está vacío, sigue a `AGENT_CURSOR_MODE` (mismo bundle que scout largo).
 * Forzar ON aunque el cursor esté en clásico: `AGENT_UNIFIED_TURN_LOOP=1`.
 */
const unifiedTurnLoopHabilitado = () => {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return false;
  const raw = String(process.env.AGENT_UNIFIED_TURN_LOOP ?? "").trim();
  if (["0", "false", "off", "no"].includes(raw.toLowerCase())) return false;
  if (raw) return envTruthy(raw);
  return cursorMode();
};

/**
 * Clasificador LLM + verify **dentro** del turno unificado (tras hilo/catch-all): default ON con bucle unificado.
 * Apagar: `AGENT_CLASIFICADOR_EN_BUCLE=0` (vuelve el clasificador previo a dominio).
 */
const clasificadorDeferidoAlBucleUnificado = () => {
  if (!unifiedTurnLoopHabilitado()) return false;
  return defaultOnUnlessOff("AGENT_CLASIFICADOR_EN_BUCLE");
};

/**
 * @param {{
 *   clasificacion: object,
 *   usuario: object|null,
 *   numeroWhatsapp: string,
 *   mensaje: string,
 *   deferClasificador?: boolean,
 *   soloAgenteWhatsapp?: boolean,
 *   historialReciente?: object[],
 *   intencionPrecalculada?: object|null,
 * }} input
 * @returns {Promise<{ texto: string, toolTrace: object[], usedInvokeRouter: boolean, earlyDominioRepregunta?: boolean }>}
 */
const ejecutarTurnoUnificado = async ({
  clasificacion,
  usuario,
  numeroWhatsapp,
  mensaje,
  deferClasificador = false,
  soloAgenteWhatsapp = false,
  historialReciente = [],
  intencionPrecalculada = null,
}) => {
  const trace = [];
  const { routear } = require("../../router");
  const mensajeTrim = String(mensaje || "").trim();

  let all = listTools().filter((t) => String(t.name || "").startsWith("agent."));
  if (!all.some((t) => t.name === "agent.invoke_router")) {
    return {
      texto: String(
        (await routear({ clasificacion, mensaje: mensajeTrim, usuario, numeroWhatsapp, historialReciente })) || ""
      ).trim(),
      toolTrace: trace,
      usedInvokeRouter: false,
    };
  }

  const toolCtx = {
    clasificacion,
    usuario,
    numeroWhatsapp,
    mensaje: mensajeTrim,
    historialReciente: Array.isArray(historialReciente) ? historialReciente : [],
    intencionPrecalculada,
  };

  if (deferClasificador && !soloAgenteWhatsapp) {
    const invCl = await invokeTool("agent.clasificar", {}, toolCtx);
    trace.push({ turn: -1, tool: "agent.clasificar", ok: invCl.ok, error: invCl.error || null, auto: true });
    const dom = await evaluarDominioTurnoAntesDeRouter({
      clasificacion,
      mensaje: mensajeTrim,
      usuario,
      numeroWhatsapp,
      historialPrecargado: toolCtx.historialReciente,
    });
    if (dom.accion === "repregunta_dominio" && String(dom.texto || "").trim()) {
      return {
        texto: String(dom.texto).trim(),
        toolTrace: trace,
        usedInvokeRouter: false,
        earlyDominioRepregunta: true,
      };
    }
  }

  const system = soloAgenteWhatsapp
    ? [
        "Sos el agente conversacional de AgroHabilis (WhatsApp, productores argentinos). Respondé con claridad y tono cercano.",
        "Si el productor pide precios, clima, datos de su cosecha, registrar algo o un comando del bot (MI RESUMEN, VER COMANDOS, etc.), llamá `agent.invoke_router` y podés pasar `clasificacion_patch` con la intención correcta (`precio`, `clima`, `registrar`, `comando`, …) y cultivo si aplica.",
        "Si solo charla sobre el producto o el agro sin pedir datos del sistema, podés responder en texto; para operaciones del bot usá `agent.invoke_router`.",
        "No inventes cotizaciones de mercado ni cifras contractuales sin haber ejecutado `agent.invoke_router` con la intención adecuada.",
        "Podés llamar `agent.clasificar` si necesitás re-etiquetar tras leer historial u otras tools.",
        "Tenés herramientas `agent.*` para documentación interna, historial, datos compactos, etc.",
        "Para cerrar con datos del motor interno (precios reales, plantillas, comandos) debés llamar `agent.invoke_router`; podés pasar `scout_context` breve y `clasificacion_patch` si corregís intención o cultivo.",
        "Si ya alcanza con el estado actual, llamá `agent.invoke_router` con `{}`.",
        "REGLA CRÍTICA DE AMBIGÜEDAD: Si el mensaje del productor es extremadamente escueto y solo indica una cantidad y categoría de inventario sin un verbo claro (ej: 'Stock ganadero 100 vacas'), NO llames a `agent.invoke_router` ni parches a precio. En su lugar, respondé directamente en texto al productor con una repregunta interactiva cercana (Doble Opción) ofreciendo si desea registrarlo en inventario o consultar precios de mercado. Ej: '¡Hola! Mencionás 100 vacas. ¿Querés que las registre en tu inventario o querés consultar la cotización de hoy?'",
      ].join(" ")
    : [
        "Sos el agente de *un turno* de AgroHabilis (WhatsApp, productores argentinos).",
        deferClasificador
          ? "La intención ya quedó fijada por el clasificador al inicio de este turno; llamá `agent.clasificar` solo si tras leer historial u otras tools ves una inconsistencia clara."
          : "Podés llamar `agent.clasificar` si necesitás re-etiquetar el mensaje tras leer más contexto.",
        "Tenés herramientas `agent.*` para leer documentación interna, historial, datos compactos del usuario, etc.",
        "Para entregar la respuesta que verá el productor debés llamar a la función `agent.invoke_router`.",
        "Ahí corre el motor interno (precios reales, clima, plantillas, comandos): no inventes cotizaciones en texto libre.",
        "Podés pasar en `scout_context` un resumen breve de lo hallado con otras tools, y `clasificacion_patch` solo si corregís intención o cultivo respecto del estado actual.",
        "Si no necesitás más datos, llamá `agent.invoke_router` con argumentos vacíos `{}`.",
        "REGLA CRÍTICA DE AMBIGÜEDAD: Si el mensaje del productor es extremadamente escueto y solo indica una cantidad y categoría de inventario sin un verbo claro (ej: 'Stock ganadero 100 vacas'), NO llames a `agent.invoke_router` ni parches a precio. En su lugar, respondé directamente en texto al productor con una repregunta interactiva cercana (Doble Opción) ofreciendo si desea registrarlo en inventario o consultar precios de mercado. Ej: '¡Hola! Mencionás 100 vacas. ¿Querés que las registre en tu inventario o querés consultar la cotización de hoy?'",
      ].join(" ");

  const userBlock = [
    `Mensaje del productor: ${mensajeTrim}`,
    `Clasificación actual (referencia): intención=${String(clasificacion?.intencion || "").trim()}, cultivo=${String(clasificacion?.cultivo || "").trim()}, confianza=${String(clasificacion?.confianza || "").trim()}.`,
    usuario?.id ? `Usuario_id: ${usuario.id}` : "Usuario: sin id (onboarding posible).",
  ].join("\n");

  const tools = toOpenAiToolDefinitions(all);
  const maxTurns = scoutMaxTurns();
  const maxToolCalls = scoutMaxToolCalls();

  /** @type {object[]} */
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userBlock },
  ];

  let toolCallsEjecutados = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const data = await postOpenRouterChat(
      {
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.22,
      },
      { xTitle: "AgroHabilis-agent-unified", temperature: 0.22 }
    );
    const msg = data?.choices?.[0]?.message;
    if (!msg) {
      trace.push({ turn, error: "sin_message" });
      break;
    }
    messages.push(msg);

    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (calls.length) {
      for (const tc of calls) {
        if (toolCallsEjecutados >= maxToolCalls) break;
        const name = String(tc?.function?.name || "").trim();
        const args = parseToolArgs(tc?.function?.arguments);
        const id = String(tc?.id || "").trim() || `call_${toolCallsEjecutados}`;
        const inv = await invokeTool(name, args, toolCtx);
        toolCallsEjecutados += 1;
        trace.push({ turn, tool: name, ok: inv.ok, error: inv.error || null });
        messages.push({
          role: "tool",
          tool_call_id: id,
          content: JSON.stringify(inv.ok ? inv.result ?? { ok: true } : { ok: false, error: inv.error }),
        });

        if (name === "agent.invoke_router" && inv.ok && inv.result && String(inv.result.texto || "").trim()) {
          return {
            texto: String(inv.result.texto).trim(),
            toolTrace: trace,
            usedInvokeRouter: true,
          };
        }
      }
      if (toolCallsEjecutados >= maxToolCalls) break;
      continue;
    }

    const textoAsistente = String(msg.content || "").trim();
    if (textoAsistente) {
      // Si es una repregunta interactiva (Doble Opción), la devolvemos directamente
      // para evitar diluirla o alterarla a través de routear y el renderTemplate de agro_general.
      const esDobleOpcion = textoAsistente.includes("¿") && 
        (textoAsistente.toLowerCase().includes("registr") || textoAsistente.toLowerCase().includes("guard")) &&
        (textoAsistente.toLowerCase().includes("precio") || textoAsistente.toLowerCase().includes("cotiz"));
      
      if (esDobleOpcion) {
        trace.push({ turn, direct_reprompt: true });
        return {
          texto: textoAsistente,
          toolTrace: trace,
          usedInvokeRouter: false,
        };
      }

      clasificacion.agentScoutContext = textoAsistente.slice(0, 6000);
      const texto = String(
        (await routear({
          clasificacion,
          mensaje: mensajeTrim,
          usuario,
          numeroWhatsapp,
          historialReciente,
        })) || ""
      ).trim();
      return { texto, toolTrace: trace, usedInvokeRouter: false };
    }
    trace.push({ turn, error: "contenido_vacio" });
    break;
  }

  const texto = String(
    (await routear({
      clasificacion,
      mensaje: mensajeTrim,
      usuario,
      numeroWhatsapp,
      historialReciente,
    })) || ""
  ).trim();
  return { texto, toolTrace: trace, usedInvokeRouter: false };
};

module.exports = {
  ejecutarTurnoUnificado,
  unifiedTurnLoopHabilitado,
  clasificadorDeferidoAlBucleUnificado,
};
