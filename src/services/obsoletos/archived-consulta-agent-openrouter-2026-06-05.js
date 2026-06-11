"use strict";

/**
 * Agente con tool-calling (OpenRouter / Gemini) para la plantilla `consulta`.
 * Exportado vía `services/agent` por si se reutiliza; **`renderizar` en `templates/consulta.js` ya no lo invoca** (redacción siempre por `generarConPromptLibre` + grounding opcional).
 */

const { GoogleGenerativeAI, FunctionCallingMode } = require("@google/generative-ai");
const { invokeTool, listTools } = require("../tools");
const { postOpenRouterChat, parseToolArgs, toOpenAiToolDefinitions } = require("./openrouter_chat");
const { geminiSafeToolName, registryToolToGeminiDeclaration } = require("./gemini_schema_for_tools");

const getIaTimeoutMs = () => {
  const n = Number(process.env.IA_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 15000;
};

const conTimeout = async (promise, ms, label = "IA") => {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, limite]);
  } finally {
    clearTimeout(timer);
  }
};

const getGeminiModelName = () => process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";

/** Orden de proveedor para la plantilla consulta (primer API key disponible gana). */
const ordenProveedoresConsultaAgente = () =>
  String(process.env.AGENT_CONSULTA_IA_ORDER || "openrouter,gemini")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x === "openrouter" || x === "gemini");

const resolveConsultaAgentProvider = () => {
  for (const p of ordenProveedoresConsultaAgente()) {
    if (p === "openrouter" && process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
    if (p === "gemini" && process.env.GEMINI_API_KEY?.trim()) return "gemini";
  }
  return null;
};

/** Hay al menos un proveedor (OpenRouter o Gemini) para el agente de plantilla `consulta`. */
const consultaTemplateUsaAgenteIa = () => resolveConsultaAgentProvider() != null;

/** @deprecated mismo criterio que `consultaTemplateUsaAgenteIa` (nombre histórico). */
const consultaTemplateUsaAgenteOpenRouter = consultaTemplateUsaAgenteIa;

const allowlistConsultaAgente = () =>
  String(
    process.env.AGENT_CONSULTA_TOOL_ALLOWLIST ||
      "agent.consulta_datos_compactos,agent.workspace_doc,agent.historial_snippet"
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const buildAgentContext = ({
  usuario,
  pregunta,
  payload,
  respuestaBase,
  climaPronosticoResumen,
}) => {
  const trace = [];
  const allow = new Set(allowlistConsultaAgente());
  const all = listTools().filter((t) => allow.has(t.name));
  if (!all.length) {
    throw new Error("consulta_agent: sin tools en allowlist");
  }
  const consultaAgentePayload = {
    fecha_hoy_ar: payload?.fecha_hoy_ar || null,
    respuesta_base: String(respuestaBase || "").slice(0, 14000),
    clima_pronostico_resumen: String(climaPronosticoResumen || "").slice(0, 2500),
    datos_json: JSON.stringify(payload?.datos != null ? payload.datos : {}).slice(0, 16000),
    contexto_hilo: payload?.contexto_hilo_resuelto
      ? JSON.stringify(payload.contexto_hilo_resuelto).slice(0, 5000)
      : "",
  };
  const toolCtx = {
    usuario,
    numeroWhatsapp: usuario?.whatsapp || usuario?.whatsapp_real || "",
    clasificacion: {},
    consultaAgentePayload,
  };
  const zona = `${usuario?.partido || ""}, ${usuario?.provincia || ""}`.trim() || "Argentina";
  const system = [
    "Sos *AgroHabilis*, asistente agropecuario en WhatsApp para productores argentinos.",
    "Tenés herramientas para leer hechos internos (BD/resumen), documentación de contexto y el historial reciente del mismo número.",
    "Reglas:",
    "- La herramienta `agent.consulta_datos_compactos` resume lo que ya calculó el motor interno: tratá esos hechos como verdad salvo que digan explícitamente que falta dato.",
    "- No repitas la pregunta del productor como primera línea ni como encabezado.",
    "- Respondé en español rioplatense, tono conversacional y directo (como un agente útil, no como un informe con secciones rígidas salvo que el usuario pida explícitamente un informe).",
    "- Si la consulta mezcla venta/mercado y clima, integrá ambos en la misma respuesta coherente.",
    "- No inventes precios, fechas ni fuentes que no estén en herramientas o en respuesta_base.",
    "- Máximo ~40 líneas; usá *negrita* solo para destacar cifras o alertas.",
    "- No uses el encabezado de marca «Base AgroHabilis» ni bloques ━ decorativos salvo que el usuario pida un formato formal.",
  ].join("\n");
  const infoDelegado = usuario?.es_delegado
    ? `⚠️ OPERARIO ACTIVO CHATEANDO: ${usuario.nombre_operario} (rol: ${usuario.rol_operario}). Mapeado a la cuenta principal del dueño: ${usuario.nombre}. Por favor, saludá a ${usuario.nombre_operario} y mencioná la cuenta principal.`
    : "";

  const userBlock = [
    `Zona del productor: ${zona}.`,
    usuario?.nombre ? `Nombre del dueño/establecimiento: ${usuario.nombre}.` : "",
    infoDelegado,
    "",
    `Consulta: ${String(pregunta || "").trim().slice(0, 900)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const maxTurns = Math.min(
    10,
    Math.max(1, Number.parseInt(String(process.env.AGENT_CONSULTA_MAX_TURNS || "8"), 10) || 8)
  );
  const maxToolCalls = Math.min(
    16,
    Math.max(1, Number.parseInt(String(process.env.AGENT_CONSULTA_MAX_TOOL_CALLS || "10"), 10) || 10)
  );
  const ms = Number(process.env.AGENT_TOOL_LOOP_TIMEOUT_MS || process.env.IA_TIMEOUT_MS || 20000);
  const timeoutMs = Number.isFinite(ms) && ms > 0 ? ms : 20000;

  return {
    all,
    toolCtx,
    system,
    userBlock,
    trace,
    maxTurns,
    maxToolCalls,
    timeoutMs,
    consultaAgentePayload,
  };
};

const ejecutarLoopOpenRouter = async (ctx) => {
  const { all, toolCtx, system, userBlock, trace, maxTurns, maxToolCalls, timeoutMs } = ctx;
  const tools = toOpenAiToolDefinitions(all);
  const messages = [
    { role: "system", content: system },
    { role: "user", content: userBlock },
  ];
  let toolCallsEjecutados = 0;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const data = await conTimeout(
      postOpenRouterChat(
        {
          messages,
          tools,
          tool_choice: "auto",
        },
        { xTitle: "AgroHabilis-consulta-agent", temperature: 0.28 }
      ),
      timeoutMs,
      "openrouter.consulta_agent"
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
    if (!texto) {
      trace.push({ turn, error: "contenido_vacio" });
      break;
    }
    return {
      texto,
      toolTrace: trace,
      iaProvider: "openrouter_agent",
      respuestaPipeline: "openrouter_agent_consulta",
    };
  }
  const fallback = [...messages].reverse().find((m) => m.role === "assistant" && String(m.content || "").trim());
  const texto = String(fallback?.content || "").trim();
  if (texto) {
    return { texto, toolTrace: trace, iaProvider: "openrouter_agent", respuestaPipeline: "openrouter_agent_consulta" };
  }
  return {
    texto: String(ctx.respuestaBaseFallback || "").trim(),
    toolTrace: trace,
    iaProvider: "openrouter_agent",
    respuestaPipeline: "openrouter_agent_consulta",
  };
};

const ejecutarLoopGemini = async (ctx) => {
  const { all, toolCtx, system, userBlock, trace, maxTurns, maxToolCalls, timeoutMs, respuestaBaseFallback } = ctx;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const geminiToReal = new Map();
  const functionDeclarations = all.map((t) => {
    const gname = geminiSafeToolName(t.name);
    geminiToReal.set(gname, t.name);
    return registryToolToGeminiDeclaration(t, gname);
  });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: getGeminiModelName(),
    systemInstruction: system,
    tools: [{ functionDeclarations }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
    generationConfig: { temperature: 0.28 },
  });
  const chat = model.startChat({});

  let result = await conTimeout(chat.sendMessage(userBlock), timeoutMs, "gemini.consulta_agent");
  let toolCallsEjecutados = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let calls;
    try {
      calls = result.response.functionCalls();
    } catch (_e) {
      calls = undefined;
    }
    if (calls && calls.length) {
      const responseParts = [];
      for (const call of calls) {
        if (toolCallsEjecutados >= maxToolCalls) break;
        const gName = String(call?.name || "").trim();
        const realName = geminiToReal.get(gName) || gName;
        const args = call.args && typeof call.args === "object" ? call.args : {};
        const inv = await invokeTool(realName, args, toolCtx);
        toolCallsEjecutados += 1;
        trace.push({ turn, tool: realName, ok: inv.ok, error: inv.error || null });
        responseParts.push({
          functionResponse: {
            name: gName,
            response: inv.ok ? inv.result ?? { ok: true } : { ok: false, error: inv.error },
          },
        });
      }
      if (!responseParts.length) break;
      if (toolCallsEjecutados >= maxToolCalls) break;
      result = await conTimeout(chat.sendMessage(responseParts), timeoutMs, "gemini.consulta_agent.tools");
      continue;
    }
    let texto = "";
    try {
      texto = String(result.response.text() || "").trim();
    } catch (_e) {
      texto = "";
    }
    if (!texto) {
      trace.push({ turn, error: "contenido_vacio" });
      break;
    }
    return {
      texto,
      toolTrace: trace,
      iaProvider: "gemini_agent",
      respuestaPipeline: "gemini_agent_consulta",
    };
  }

  return {
    texto: String(respuestaBaseFallback || "").trim(),
    toolTrace: trace,
    iaProvider: "gemini_agent",
    respuestaPipeline: "gemini_agent_consulta",
  };
};

/**
 * @param {{
 *   usuario: object,
 *   pregunta: string,
 *   payload: object,
 *   respuestaBase: string,
 *   climaPronosticoResumen: string,
 * }} p
 * @returns {Promise<{ texto: string, toolTrace: object[], iaProvider: string, respuestaPipeline: string }>}
 */
const ejecutarConsultaTemplateAgente = async ({
  usuario,
  pregunta,
  payload,
  respuestaBase,
  climaPronosticoResumen,
}) => {
  const provider = resolveConsultaAgentProvider();
  if (!provider) {
    throw new Error("consulta_agent: sin OPENROUTER_API_KEY ni GEMINI_API_KEY");
  }
  const baseCtx = buildAgentContext({
    usuario,
    pregunta,
    payload,
    respuestaBase,
    climaPronosticoResumen,
  });
  const ctx = { ...baseCtx, respuestaBaseFallback: respuestaBase };
  if (provider === "openrouter") {
    return ejecutarLoopOpenRouter(ctx);
  }
  return ejecutarLoopGemini(ctx);
};

module.exports = {
  consultaTemplateUsaAgenteIa,
  consultaTemplateUsaAgenteOpenRouter,
  resolveConsultaAgentProvider,
  ordenProveedoresConsultaAgente,
  ejecutarConsultaTemplateAgente,
};
