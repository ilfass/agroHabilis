"use strict";

/**
 * Agente estilo Cursor — **por defecto activo** (vacío en env = ON).
 * Desactivar: `AGENT_CURSOR_MODE=0`, `AGENT_IA_TOTAL=0`, `INVENTARIO_SOLO_LLM=0`, etc.
 */

const offExplicit = (key) =>
  ["0", "false", "off", "no"].includes(String(process.env[key] ?? "").trim().toLowerCase());

/** ON salvo que la variable exista y sea explícitamente apagada. */
const defaultOnUnlessOff = (key) => !offExplicit(key);

const cursorMode = () => defaultOnUnlessOff("AGENT_CURSOR_MODE");

const clampInt = (n, lo, hi, fallback) => {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, x));
};

const clasificadorHistorialLimite = () => {
  const raw = String(process.env.AGENT_HISTORIAL_CLASIFICADOR_LIMITE ?? "").trim();
  if (raw) return clampInt(raw, 1, 64, 8);
  return cursorMode() ? 40 : 8;
};

const historialHiloPromptTurnos = () => {
  const raw = String(process.env.AGENT_HISTORIAL_HILO_IA_TURNOS ?? "").trim();
  if (raw) return clampInt(raw, 3, 24, 5);
  return cursorMode() ? 16 : 5;
};

const dominioHistorialLimite = () => {
  const raw = String(process.env.AGENT_HISTORIAL_DOMINIO_LIMITE ?? "").trim();
  if (raw) return clampInt(raw, 1, 32, 8);
  return cursorMode() ? 20 : 8;
};

const clasificadorHistorialFormateoTurnos = () => Math.min(28, clasificadorHistorialLimite());

const scoutMaxTurns = () => {
  const raw = String(process.env.AGENT_TOOL_LOOP_MAX_TURNS ?? "").trim();
  if (!raw) return cursorMode() ? 24 : 5;
  const v = clampInt(raw, 1, 48, 5);
  return cursorMode() ? Math.max(v, 20) : v;
};

const scoutMaxToolCalls = () => {
  const raw = String(process.env.AGENT_TOOL_LOOP_MAX_TOOL_CALLS ?? "").trim();
  if (!raw) return cursorMode() ? 32 : 6;
  const v = clampInt(raw, 1, 64, 6);
  return cursorMode() ? Math.max(v, 24) : v;
};

const scoutAllowlistExtra = () => {
  const extra = String(process.env.AGENT_SCOUT_TOOL_ALLOWLIST_EXTRA || "").trim();
  if (extra) return extra.split(",").map((x) => x.trim()).filter(Boolean);
  return cursorMode() ? ["agent.workspace_list", "agent.consulta_datos_compactos"] : [];
};

const verifyRouterMaxAttempts = () => {
  const raw = String(process.env.AGENT_VERIFY_ROUTER_MAX ?? "").trim();
  if (!raw) return cursorMode() ? 4 : 2;
  const v = clampInt(raw, 1, 6, 2);
  return cursorMode() ? Math.max(v, 4) : v;
};

const oavStepMaxAttemptsCap = () => (cursorMode() ? 8 : 4);

/**
 * Inventario WhatsApp: sin `parseIntentInventario`; IA + multi‑lote estructural.
 * Default ON (vacío = sí). `INVENTARIO_SOLO_LLM=0` para heurística antigua.
 */
const inventarioSoloLlm = () => defaultOnUnlessOff("INVENTARIO_SOLO_LLM");

/** Diálogo hilo: sin atajos regex. Default ON. */
const dialogoHiloSinAtajoHeuristico = () => defaultOnUnlessOff("DIALOGO_HILO_SIN_ATAJO_HEURISTICO");

/** Modo “IA total” en pipeline: sin catch-all regex ni repregunta heurística por confianza baja; sin `clasificarHeuristica` si hay proveedor IA. Default ON. */
const agentIaTotal = () => defaultOnUnlessOff("AGENT_IA_TOTAL");

const explicitOn = (key) => {
  const v = String(process.env[key] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

/**
 * WhatsApp: un solo camino por bucle OpenRouter + tools; sin clasificador LLM previo ni gate de dominio antes del router.
 * Requiere `OPENROUTER_API_KEY`. Default OFF (solo con `AGENT_WHATSAPP_SOLO_AGENTE=1` u on explícito).
 */
const soloAgenteWhatsappActivo = () => {
  if (!process.env.OPENROUTER_API_KEY?.trim()) return false;
  return explicitOn("AGENT_WHATSAPP_SOLO_AGENTE");
};

module.exports = {
  cursorMode,
  clasificadorHistorialLimite,
  historialHiloPromptTurnos,
  dominioHistorialLimite,
  clasificadorHistorialFormateoTurnos,
  scoutMaxTurns,
  scoutMaxToolCalls,
  scoutAllowlistExtra,
  verifyRouterMaxAttempts,
  oavStepMaxAttemptsCap,
  inventarioSoloLlm,
  dialogoHiloSinAtajoHeuristico,
  defaultOnUnlessOff,
  agentIaTotal,
  explicitOn,
  soloAgenteWhatsappActivo,
};
