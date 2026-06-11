"use strict";

/**
 * Registro de herramientas al estilo MCP: nombre, descripción, esquema de parámetros y ejecutor.
 * Pensado para invocación desde código (y futura selección por modelo con JSON de tool_calls).
 */

const tools = new Map();

/**
 * @param {{ name: string, description?: string, parameters?: object, execute: (ctx: object, args: object) => Promise<unknown> }} def
 */
const registerTool = (def) => {
  const name = String(def?.name || "").trim();
  if (!name || typeof def.execute !== "function") {
    throw new Error("registerTool: requiere name y execute");
  }
  tools.set(name, {
    name,
    description: String(def.description || "").trim(),
    parameters: def.parameters && typeof def.parameters === "object" ? def.parameters : {},
    execute: def.execute,
  });
};

const validateArgs = (schema, args) => {
  if (!schema || schema.type !== "object") return { ok: true };
  const req = Array.isArray(schema.required) ? schema.required : [];
  const a = args && typeof args === "object" ? args : {};
  for (const k of req) {
    if (a[k] === undefined || a[k] === null) {
      return { ok: false, error: `Falta parámetro requerido: ${k}` };
    }
  }
  return { ok: true };
};

/**
 * @param {string} name
 * @param {object} args
 * @param {object} ctx — p.ej. `{ clasificacion, usuario, numeroWhatsapp }`
 * @returns {Promise<{ ok: boolean, tool?: string, result?: unknown, error?: string }>}
 */
const invokeTool = async (name, args = {}, ctx = {}) => {
  const normName = String(name || "").trim();
  let t = tools.get(normName);
  if (!t) {
    if (tools.has(`domain.${normName}`)) {
      t = tools.get(`domain.${normName}`);
    } else if (tools.has(`agent.${normName}`)) {
      t = tools.get(`agent.${normName}`);
    }
  }
  if (!t) {
    return { ok: false, tool: name, error: `Tool desconocida: ${name}` };
  }
  const v = validateArgs(t.parameters, args);
  if (!v.ok) {
    return { ok: false, tool: t.name, error: v.error };
  }
  try {
    const result = await t.execute(ctx, args);
    return { ok: true, tool: t.name, result };
  } catch (e) {
    return { ok: false, tool: t.name, error: String(e?.message || e) };
  }
};

const listTools = () =>
  [...tools.values()].map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

const getTool = (name) => tools.get(String(name || "").trim()) || null;

module.exports = {
  registerTool,
  invokeTool,
  listTools,
  getTool,
};
