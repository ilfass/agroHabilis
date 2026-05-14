"use strict";

/**
 * tool_first_turn.js — Pipeline donde el LLM actúa directamente como router.
 *
 * Diferencia con unified_turn_loop.js:
 * - No requiere un clasificador previo.
 * - Expone solo las tools `domain.*` (rutas de negocio directas).
 * - El LLM lee el mensaje + perfil + historial y llama la tool correcta.
 * - No hay switch de intenciones en código: el LLM decide.
 *
 * Activar: AGENT_TOOL_FIRST_MODE=1 (requiere OPENROUTER_API_KEY).
 * El pipeline principal usa esto como primer camino y cae al clásico si falla.
 */

const { listTools, invokeTool } = require("../tools");
const { postOpenRouterChat, parseToolArgs, toOpenAiToolDefinitions } = require("./openrouter_chat");
const { scoutMaxTurns, scoutMaxToolCalls, defaultOnUnlessOff } = require("../cursor_mode");

/**
 * Habilitado si hay OPENROUTER_API_KEY y AGENT_TOOL_FIRST_MODE no está explícitamente apagado.
 * Por defecto OFF hasta validación (solo se activa con AGENT_TOOL_FIRST_MODE=1).
 */
const toolFirstModeHabilitado = () => {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return false;
  const raw = String(process.env.AGENT_TOOL_FIRST_MODE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
};

/**
 * Formatea el historial reciente para el system prompt.
 * @param {object[]} historial
 * @returns {string}
 */
const formatearHistorial = (historial = []) => {
  if (!Array.isArray(historial) || !historial.length) return "";
  const lineas = historial
    .slice(-10) // últimas 10 interacciones max en el prompt
    .map((h) => {
      const q = String(h.pregunta || "").trim().slice(0, 180);
      const r = String(h.respuesta || "").trim().slice(0, 300);
      return `Productor: ${q}\nAsistente: ${r}`;
    })
    .join("\n\n");
  return `\n\n--- Conversación reciente ---\n${lineas}`;
};

/**
 * Formatea el perfil del usuario para el system prompt.
 * @param {object|null} usuario
 * @returns {string}
 */
const formatearPerfil = (usuario) => {
  if (!usuario?.id) return "Usuario: sin perfil registrado (posible onboarding).";
  const nombre = String(usuario.nombre || "").trim() || "Productor";
  const zona = String(usuario.localidad || usuario.provincia || "").trim() || "zona no especificada";
  const cultivos = Array.isArray(usuario.cultivos) && usuario.cultivos.length
    ? usuario.cultivos.join(", ")
    : "no especificados";
  const plan = String(usuario.plan || "free").trim();
  return `Usuario: ${nombre} · Zona: ${zona} · Cultivos: ${cultivos} · Plan: ${plan}`;
};

/**
 * System prompt para el modo tool-first.
 * Explica al LLM cuándo usar cada domain tool.
 */
const buildSystemPrompt = ({ usuario, historialReciente }) => {
  const perfil = formatearPerfil(usuario);
  const hist = formatearHistorial(historialReciente);
  return [
    "Sos AgroHabilis, asistente agropecuario por WhatsApp para productores argentinos.",
    "Respondé siempre en español rioplatense, tono directo, práctico y cercano.",
    "",
    "REGLA CRÍTICA: No inventes precios, cotizaciones, cifras de clima ni datos de campo del productor.",
    "Para cualquier dato concreto (precios, clima, registros, análisis) tenés tools. Siempre llamalas antes de responder.",
    "",
    perfil,
    hist,
    "",
    "CUÁNDO USAR CADA TOOL:",
    "- domain.get_prices: precios de granos (soja, maíz, trigo...), hacienda (novillo, vaca...), insumos, dólar.",
    "- domain.get_weather: clima, lluvia, temperatura, pronóstico, alertas climáticas.",
    "- domain.register_movement: cuando el productor dice que vendió, gastó, compró, o quiere cargar un dato.",
    "- domain.get_records: cuando pregunta por sus propios datos ya cargados (mis gastos, mis ventas, inventario, lotes).",
    "- domain.market_analysis: análisis de mercado, tendencias, perspectivas, noticias del agro.",
    "- domain.my_analysis: análisis personalizado combinando sus datos con el mercado (¿me conviene vender?).",
    "- domain.run_command: comandos del bot (MI RESUMEN, VER COMANDOS, MIS ALERTAS, PLANES, etc.).",
    "- domain.agro_general: dudas técnicas, buenas prácticas, preguntas sobre qué puede hacer el bot (capacidades, si permite lotes múltiples, seguimiento de animales), saludos, o cualquier consulta que no encaje en otra tool.",
    "",
    "Si el mensaje es claramente conversacional (saludo simple, agradecimiento) podés responder sin tool.",
    "Para todo lo demás: primero la tool, luego la respuesta.",
  ].join("\n");
};

/**
 * Ejecuta un turno completo usando solo tools `domain.*`.
 * El LLM actúa como router sin clasificador previo.
 *
 * @param {{
 *   usuario: object|null,
 *   numeroWhatsapp: string,
 *   mensaje: string,
 *   historialReciente?: object[],
 * }} input
 * @returns {Promise<{ texto: string, toolTrace: object[], domainToolUsed: string|null }>}
 */
const ejecutarToolFirstTurn = async ({
  usuario,
  numeroWhatsapp,
  mensaje,
  historialReciente = [],
}) => {
  const mensajeTrim = String(mensaje || "").trim();
  const trace = [];

  // Solo ofrecemos las tools domain.* + agent.turn_step (observabilidad)
  const allTools = listTools().filter(
    (t) =>
      String(t.name || "").startsWith("domain.") ||
      t.name === "agent.turn_step"
  );

  if (!allTools.some((t) => t.name.startsWith("domain."))) {
    return {
      texto: "",
      toolTrace: trace,
      domainToolUsed: null,
      error: "sin_domain_tools_registradas",
    };
  }

  const toolCtx = {
    // clasificacion placeholder — las domain tools lo ignorarán o usarán su propio patch
    clasificacion: { intencion: "agro_general", confianza: "media" },
    usuario: usuario || null,
    numeroWhatsapp,
    mensaje: mensajeTrim,
    historialReciente: Array.isArray(historialReciente) ? historialReciente : [],
  };

  const system = buildSystemPrompt({ usuario, historialReciente });
  const tools = toOpenAiToolDefinitions(allTools);
  const maxTurns = scoutMaxTurns();
  const maxToolCalls = scoutMaxToolCalls();

  const messages = [
    { role: "system", content: system },
    { role: "user", content: mensajeTrim },
  ];

  let toolCallsEjecutados = 0;
  let domainToolUsed = null;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let data;
    try {
      data = await postOpenRouterChat(
        {
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.18, // más determinista que el loop unificado
        },
        { xTitle: "AgroHabilis-tool-first", temperature: 0.18 }
      );
    } catch (err) {
      trace.push({ turn, error: `openrouter_error: ${err?.message || err}` });
      break;
    }

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
          content: JSON.stringify(
            inv.ok ? inv.result ?? { ok: true } : { ok: false, error: inv.error }
          ),
        });

        // Si una domain tool devolvió texto, es la respuesta final
        if (
          name.startsWith("domain.") &&
          inv.ok &&
          String(inv.result?.texto || "").trim()
        ) {
          domainToolUsed = name;
          return {
            texto: String(inv.result.texto).trim(),
            toolTrace: trace,
            domainToolUsed,
          };
        }
      }

      if (toolCallsEjecutados >= maxToolCalls) break;
      continue;
    }

    // El LLM respondió en texto directo (sin tool call) — válido para saludos, etc.
    const textoAsistente = String(msg.content || "").trim();
    if (textoAsistente) {
      trace.push({ turn, direct_text: true });
      return {
        texto: textoAsistente,
        toolTrace: trace,
        domainToolUsed: null,
      };
    }

    trace.push({ turn, error: "contenido_vacio" });
    break;
  }

  // Sin resultado → el llamador hace fallback al pipeline clásico
  return {
    texto: "",
    toolTrace: trace,
    domainToolUsed: null,
  };
};

module.exports = {
  toolFirstModeHabilitado,
  ejecutarToolFirstTurn,
};
