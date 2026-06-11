"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const ENV_PATH = () => path.join(process.cwd(), ".env");

/** Solo claves operativas del agente (sin secretos ni credenciales). */
const EDITABLE_DEFS = [
  {
    key: "AGENT_CURSOR_MODE",
    kind: "bool",
    label: "Modo agente (Cursor)",
    description:
      "Historial amplio, límites altos y comportamiento orientado a agente. Vacío en .env = activo; explícito 0 lo apaga.",
  },
  {
    key: "AGENT_IA_TOTAL",
    kind: "bool",
    label: "IA total en pipeline",
    description: "Sin catch-all regex ni repregunta heurística por confianza baja antes del router.",
  },
  {
    key: "AGENT_UNIFIED_TURN_LOOP",
    kind: "bool",
    label: "Bucle unificado OpenRouter",
    description: "Un solo bucle con tools y agent.invoke_router (requiere OPENROUTER_API_KEY).",
  },
  {
    key: "AGENT_CLASIFICADOR_EN_BUCLE",
    kind: "bool",
    label: "Clasificador en bucle",
    description: "Clasificador LLM al inicio del bucle unificado; dominio después.",
  },
  {
    key: "AGENT_WHATSAPP_SOLO_AGENTE",
    kind: "bool",
    label: "WhatsApp solo agente",
    description:
      "Sin clasificador previo ni dominio antes del router: placeholder + bucle OpenRouter; requiere unificado y OPENROUTER.",
  },
  {
    key: "AGENT_TOOL_LOOP_SCOUT",
    kind: "bool",
    label: "Scout tool-loop",
    description: "Scout con tool-calling antes del router (OpenRouter).",
  },
  {
    key: "INVENTARIO_SOLO_LLM",
    kind: "bool",
    label: "Inventario solo LLM",
    description: "Inventario WhatsApp sin atajos heurísticos de intención.",
  },
  {
    key: "DIALOGO_HILO_SIN_ATAJO_HEURISTICO",
    kind: "bool",
    label: "Diálogo hilo sin atajo heurístico",
    description: "Flujo de hilo sin regex de atajo.",
  },
  {
    key: "CLASIFICADOR_VERIFY_INTENCION",
    kind: "bool",
    label: "Verify intención (clasificador)",
    description: "Segundo pase LLM de coherencia intención vs mensaje.",
  },
  {
    key: "AGENT_CONSULTA_ASYNC",
    kind: "bool",
    label: "Cola async de consultas",
    description: "Encolar consulta y responder al instante; drenaje en el mismo proceso.",
  },
  {
    key: "AGENT_HISTORIAL_CLASIFICADOR_LIMITE",
    kind: "int",
    min: 1,
    max: 64,
    label: "Historial clasificador (turnos)",
    description: "Turnos previos inyectados al clasificador.",
  },
  {
    key: "AGENT_HISTORIAL_HILO_IA_TURNOS",
    kind: "int",
    min: 3,
    max: 24,
    label: "Historial hilo IA (turnos)",
    description: "Turnos de hilo que entran al prompt de IA.",
  },
  {
    key: "AGENT_HISTORIAL_DOMINIO_LIMITE",
    kind: "int",
    min: 1,
    max: 32,
    label: "Historial gate dominio",
    description: "Turnos para el gate de dominio agro.",
  },
  {
    key: "AGENT_TOOL_LOOP_MAX_TURNS",
    kind: "int",
    min: 1,
    max: 48,
    label: "Max turns scout / unificado",
    description: "Tope de turnos del bucle de herramientas.",
  },
  {
    key: "AGENT_TOOL_LOOP_MAX_TOOL_CALLS",
    kind: "int",
    min: 1,
    max: 64,
    label: "Max tool calls scout / unificado",
    description: "Tope de invocaciones a tools por turno.",
  },
  {
    key: "AGENT_VERIFY_ROUTER_MAX",
    kind: "int",
    min: 1,
    max: 6,
    label: "Verify router (intentos)",
    description: "Reintentos si la respuesta del router queda vacía o muy corta.",
  },
  {
    key: "AGENT_COLA_POLL_MS",
    kind: "int",
    min: 200,
    max: 60000,
    label: "Poll cola async (ms)",
    description: "Intervalo entre intentos de drenar la cola de consultas.",
  },
  {
    key: "OPENROUTER_MODEL",
    kind: "string",
    maxLen: 120,
    label: "Modelo OpenRouter",
    description: "Identificador del modelo (p. ej. openrouter/free). No incluye la API key.",
  },
  {
    key: "GEMINI_MODEL",
    kind: "string",
    maxLen: 120,
    label: "Modelo Gemini",
    description: "Modelo por defecto para llamadas Gemini.",
  },
  {
    key: "ENVIADOR_RESUMEN_DIARIO",
    kind: "bool",
    label: "Envío Automático de Resúmenes (Cron 8am)",
    description: "Activa o desactiva el envío automático masivo de boletines/resúmenes diarios a las 8:00 AM (Lunes a Viernes).",
  },
  {
    key: "OLLAMA_ENABLED",
    kind: "bool",
    label: "Ollama local activo",
    description: "Activa o desactiva Ollama local como reaseguro/fallback absoluto de IA.",
  },
  {
    key: "OLLAMA_MODEL",
    kind: "string",
    maxLen: 120,
    label: "Modelo Ollama local",
    description: "Identificador del modelo local (p. ej. llama3.2, qwen2.5:3b).",
  },
  {
    key: "OLLAMA_BASE_URL",
    kind: "string",
    maxLen: 200,
    label: "URL base Ollama",
    description: "URL donde escucha el servicio local de Ollama (por defecto http://127.0.0.1:11434).",
  },
];

const ALLOWED_KEYS = new Set(EDITABLE_DEFS.map((d) => d.key));

const buildEffectiveFromRuntime = () => {
  try {
    const {
      cursorMode,
      clasificadorHistorialLimite,
      historialHiloPromptTurnos,
      dominioHistorialLimite,
      scoutMaxTurns,
      scoutMaxToolCalls,
      verifyRouterMaxAttempts,
      inventarioSoloLlm,
      dialogoHiloSinAtajoHeuristico,
      agentIaTotal,
      soloAgenteWhatsappActivo,
    } = require("./agent/cursor_mode");
    const {
      unifiedTurnLoopHabilitado,
      clasificadorDeferidoAlBucleUnificado,
    } = require("./agent/ia/unified_turn_loop");
    const { scoutLoopHabilitado } = require("./agent/ia/tool_loop_scout");
    const verifyPostClasificadorHabilitado = () => {
      const v = String(
        process.env.CLASIFICADOR_VERIFY_INTENCION ?? process.env.CLASIFICADOR_VERIFY_HISTORIAL ?? "1"
      )
        .trim()
        .toLowerCase();
      return v !== "0" && v !== "false" && v !== "no";
    };
    const asyncCola = () =>
      ["1", "true", "yes", "on"].includes(String(process.env.AGENT_CONSULTA_ASYNC ?? "").trim().toLowerCase());
    return {
      AGENT_CURSOR_MODE: cursorMode() ? "1" : "0",
      AGENT_IA_TOTAL: agentIaTotal() ? "1" : "0",
      AGENT_UNIFIED_TURN_LOOP: unifiedTurnLoopHabilitado() ? "1" : "0",
      AGENT_CLASIFICADOR_EN_BUCLE: clasificadorDeferidoAlBucleUnificado() ? "1" : "0",
      AGENT_WHATSAPP_SOLO_AGENTE: soloAgenteWhatsappActivo() ? "1" : "0",
      AGENT_TOOL_LOOP_SCOUT: scoutLoopHabilitado() ? "1" : "0",
      INVENTARIO_SOLO_LLM: inventarioSoloLlm() ? "1" : "0",
      DIALOGO_HILO_SIN_ATAJO_HEURISTICO: dialogoHiloSinAtajoHeuristico() ? "1" : "0",
      CLASIFICADOR_VERIFY_INTENCION: verifyPostClasificadorHabilitado() ? "1" : "0",
      AGENT_CONSULTA_ASYNC: asyncCola() ? "1" : "0",
      AGENT_HISTORIAL_CLASIFICADOR_LIMITE: String(clasificadorHistorialLimite()),
      AGENT_HISTORIAL_HILO_IA_TURNOS: String(historialHiloPromptTurnos()),
      AGENT_HISTORIAL_DOMINIO_LIMITE: String(dominioHistorialLimite()),
      AGENT_TOOL_LOOP_MAX_TURNS: String(scoutMaxTurns()),
      AGENT_TOOL_LOOP_MAX_TOOL_CALLS: String(scoutMaxToolCalls()),
      AGENT_VERIFY_ROUTER_MAX: String(verifyRouterMaxAttempts()),
      AGENT_COLA_POLL_MS: String(
        Math.min(60000, Math.max(200, Math.floor(Number(process.env.AGENT_COLA_POLL_MS) || 900)))
      ),
      OPENROUTER_MODEL: String(process.env.OPENROUTER_MODEL || "openrouter/free").trim(),
      GEMINI_MODEL: String(process.env.GEMINI_MODEL || "gemini-flash-latest").trim(),
      ENVIADOR_RESUMEN_DIARIO: ["1", "true", "yes", "on"].includes(String(process.env.ENVIADOR_RESUMEN_DIARIO ?? "").trim().toLowerCase()) ? "1" : "0",
      OLLAMA_ENABLED: ["1", "true", "yes", "on"].includes(String(process.env.OLLAMA_ENABLED ?? "").trim().toLowerCase()) ? "1" : "0",
      OLLAMA_MODEL: String(process.env.OLLAMA_MODEL || "llama3.2").trim(),
      OLLAMA_BASE_URL: String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim(),
    };
  } catch (e) {
    return { _error: String(e?.message || e) };
  }
};

const parseEnvLines = (raw) => {
  const map = {};
  if (!raw) return map;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1);
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    map[k] = v;
  }
  return map;
};

const readEnvFileMap = () => {
  const p = ENV_PATH();
  if (!fs.existsSync(p)) return { exists: false, map: {} };
  const raw = fs.readFileSync(p, "utf8");
  return { exists: true, map: parseEnvLines(raw) };
};

const validatePatch = (patch) => {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "Body inválido: se espera objeto { CLAVE: valor }" };
  }
  const out = {};
  for (const [k, raw] of Object.entries(patch)) {
    if (!ALLOWED_KEYS.has(k)) {
      return { ok: false, error: `Clave no permitida: ${k}` };
    }
    const def = EDITABLE_DEFS.find((d) => d.key === k);
    const s = raw === null || raw === undefined ? "" : String(raw).trim();
    if (def.kind === "bool") {
      const low = s.toLowerCase();
      if (!["0", "1", "", "true", "false", "yes", "no", "on", "off"].includes(low) && s !== "") {
        return { ok: false, error: `Valor booleano inválido para ${k}` };
      }
      out[k] = ["1", "true", "yes", "on"].includes(low) ? "1" : "0";
    } else if (def.kind === "int") {
      const n = Math.floor(Number(s));
      if (!Number.isFinite(n)) return { ok: false, error: `Entero inválido: ${k}` };
      if (n < def.min || n > def.max) return { ok: false, error: `${k} debe estar entre ${def.min} y ${def.max}` };
      out[k] = String(n);
    } else {
      const v = String(raw ?? "").trim();
      if (!v) return { ok: false, error: `${k} no puede quedar vacío` };
      if (v.length > (def.maxLen || 200)) return { ok: false, error: `${k} demasiado largo` };
      out[k] = v;
    }
  }
  return { ok: true, values: out };
};

const upsertEnvFile = (updates) => {
  const p = ENV_PATH();
  const keysToWrite = new Set(Object.keys(updates));
  let lines = [];
  if (fs.existsSync(p)) {
    lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  } else {
    lines = ["# Generado / actualizado desde panel admin AgroHabilis", ""];
  }
  const written = new Set();
  const keyRe = (key) => new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const newLines = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return line;
    const eq = t.indexOf("=");
    if (eq <= 0) return line;
    const k = t.slice(0, eq).trim();
    if (!keysToWrite.has(k)) return line;
    written.add(k);
    const val = updates[k];
    return `${k}=${val}`;
  });
  for (const k of keysToWrite) {
    if (!written.has(k)) {
      newLines.push(`${k}=${updates[k]}`);
    }
  }
  const body = newLines.join("\n").replace(/\n+$/, "\n");
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, p);
};

const tryPm2Restart = async () => {
  const app = String(process.env.APP_NAME || process.env.PM2_APP_NAME || "agrohabilis").trim() || "agrohabilis";
  try {
    await execFileAsync("pm2", ["restart", app, "--update-env"], {
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { restarted: true, app };
  } catch (e) {
    return {
      restarted: false,
      app,
      warn: e?.message || String(e),
    };
  }
};

const getAdminEditableEnv = () => {
  const { exists, map } = readEnvFileMap();
  const effective = buildEffectiveFromRuntime();
  const fileSubset = {};
  for (const k of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(map, k)) fileSubset[k] = map[k];
  }
  return {
    envPath: ENV_PATH(),
    dotenvExists: exists,
    defs: EDITABLE_DEFS,
    fileValues: fileSubset,
    effectiveValues: effective._error ? {} : effective,
    effectiveError: effective._error || null,
  };
};

const postAdminEditableEnv = async (patch) => {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, error: "Body inválido: se espera objeto JSON { CLAVE: valor }" };
  }
  const keys = Object.keys(patch);
  if (!keys.length) {
    return { ok: false, error: "No hay claves para actualizar" };
  }
  const v = validatePatch(patch);
  if (!v.ok) return { ok: false, error: v.error };
  upsertEnvFile(v.values);
  const pm2 = await tryPm2Restart();
  Object.assign(process.env, v.values);
  return {
    ok: true,
    written: v.values,
    pm2,
  };
};

module.exports = {
  EDITABLE_DEFS,
  getAdminEditableEnv,
  postAdminEditableEnv,
};
