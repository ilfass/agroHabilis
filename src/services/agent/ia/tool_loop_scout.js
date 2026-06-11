"use strict";

const { invokeTool, listTools } = require("../tools");
const { postOpenRouterChat, parseToolArgs, toOpenAiToolDefinitions } = require("./openrouter_chat");
const {
  scoutMaxTurns,
  scoutMaxToolCalls,
  scoutAllowlistExtra,
  cursorMode,
} = require("../cursor_mode");

const envTruthy = (v) => !["0", "false", "off", "no", ""].includes(String(v ?? "").trim().toLowerCase());

const allowlistPredeterminada = () =>
  String(process.env.AGENT_LLM_TOOL_ALLOWLIST || "agent.workspace_doc,agent.historial_snippet")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const envScoutExplicitOff = () =>
  ["0", "false", "off", "no"].includes(String(process.env.AGENT_TOOL_LOOP_SCOUT ?? "").trim().toLowerCase());

/** Scout ON por defecto si hay `OPENROUTER_API_KEY`; opt-out con `AGENT_TOOL_LOOP_SCOUT=0`. */
const scoutLoopHabilitado = () => {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return false;
  if (envScoutExplicitOff()) return false;
  const raw = String(process.env.AGENT_TOOL_LOOP_SCOUT ?? "").trim();
  if (!raw) return true;
  return envTruthy(raw);
};

const intentsScoutPorDefecto =
  "agro_general,precio,clima,analisis_mercado,analisis_interno,consulta_registros,registrar";

/**
 * Bucle corto tool-calling (OpenRouter). El texto final se inyecta al router como contexto scout.
 *
 * @param {{
 *   clasificacion: object,
 *   usuario: object|null,
 *   numeroWhatsapp: string,
 *   mensaje: string,
 * }} input
 * @returns {Promise<{ resumen: string|null, toolTrace: object[] }>}
 */
const ejecutarScoutToolLoop = async ({ clasificacion, usuario, numeroWhatsapp, mensaje }) => {
  const trace = [];
  if (!scoutLoopHabilitado()) {
    return { resumen: null, toolTrace: trace };
  }

  const rawIntents = String(process.env.AGENT_TOOL_LOOP_SCOUT_INTENTS || "").trim();
  const intentsScout = (rawIntents || intentsScoutPorDefecto)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const intencionActual = String(clasificacion?.intencion || "").trim();
  if (intentsScout.length && !intentsScout.includes(intencionActual)) {
    return { resumen: null, toolTrace: trace };
  }

  const allow = new Set(allowlistPredeterminada());
  for (const n of scoutAllowlistExtra()) allow.add(n);
  let all = listTools().filter((t) => allow.has(t.name));
  if (cursorMode()) {
    const agentTools = listTools().filter((t) => String(t.name || "").startsWith("agent."));
    all = agentTools.length ? agentTools : all;
  }
  if (!all.length) {
    return { resumen: null, toolTrace: trace };
  }

  const tools = toOpenAiToolDefinitions(all);
  const maxTurns = scoutMaxTurns();
  const maxToolCalls = scoutMaxToolCalls();

  const toolCtx = { clasificacion, usuario, numeroWhatsapp };

  const system = [
    "Sos un asistente *scout* para AgroHabilis (Argentina).",
    "Podés usar las herramientas para leer documentación interna o el historial reciente del productor.",
    "Usalas solo si aportan al mensaje actual. No inventes datos que no vinieron de una herramienta.",
    "Cuando termines de usar herramientas (o si no hace falta ninguna), respondé con un único párrafo en español,",
    "empezando literalmente con la frase: «Hallazgos scout:» y luego un resumen breve de hechos útiles para contestar la consulta.",
    "Si no hay nada útil: «Hallazgos scout: Sin hallazgos adicionales.»",
  ].join(" ");

  const userBlock = [
    `Mensaje del productor: ${String(mensaje || "").trim()}`,
    `Intención clasificada: ${String(clasificacion?.intencion || "").trim()}`,
    usuario?.id ? `Usuario_id: ${usuario.id}` : "Usuario: anónimo / sin id",
  ].join("\n");

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
        temperature: 0.2,
      },
      { xTitle: "AgroHabilis-agent-scout", temperature: 0.2 }
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
      }
      if (toolCallsEjecutados >= maxToolCalls) break;
      continue;
    }

    const texto = String(msg.content || "").trim();
    return { resumen: texto || null, toolTrace: trace };
  }

  const fallback = messages.filter((m) => m.role === "assistant").pop();
  const texto = String(fallback?.content || "").trim();
  return { resumen: texto || null, toolTrace: trace };
};

module.exports = { ejecutarScoutToolLoop, envTruthy, scoutLoopHabilitado };
