"use strict";

const { SchemaType } = require("@google/generative-ai");

/**
 * Convierte un subconjunto de JSON Schema (como en `registerTool`) al formato
 * `FunctionDeclaration.parameters` del SDK Gemini.
 */
const fromJsonSchema = (schema) => {
  if (!schema || typeof schema !== "object") {
    return { type: SchemaType.STRING };
  }
  const t = String(schema.type || "string").toLowerCase();
  if (t === "object") {
    const props = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    const keys = Object.keys(props);
    const properties = {};
    for (const k of keys) {
      properties[k] = fromJsonSchema(props[k]);
    }
    if (!Object.keys(properties).length) {
      properties._ = { type: SchemaType.STRING, description: "opcional" };
    }
    const out = {
      type: SchemaType.OBJECT,
      properties,
      required: Array.isArray(schema.required) ? schema.required : undefined,
    };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (t === "array") {
    const out = {
      type: SchemaType.ARRAY,
      items: fromJsonSchema(schema.items || { type: "string" }),
    };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (t === "integer") {
    const out = { type: SchemaType.INTEGER };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (t === "number") {
    const out = { type: SchemaType.NUMBER };
    if (schema.description) out.description = schema.description;
    return out;
  }
  if (t === "boolean") {
    const out = { type: SchemaType.BOOLEAN };
    if (schema.description) out.description = schema.description;
    return out;
  }
  const out = { type: SchemaType.STRING };
  if (schema.description) out.description = schema.description;
  return out;
};

const toolParametersToGemini = (parameters) => {
  if (!parameters || typeof parameters !== "object") {
    return { type: SchemaType.OBJECT, properties: { _: { type: SchemaType.STRING, description: "opcional" } } };
  }
  return fromJsonSchema(parameters);
};

const geminiSafeToolName = (name) => String(name || "").replace(/\./g, "_");

const registryToolToGeminiDeclaration = (tool, geminiFnName) => ({
  name: geminiFnName,
  description: (tool.description || "").slice(0, 800),
  parameters: toolParametersToGemini(tool.parameters),
});

module.exports = {
  geminiSafeToolName,
  registryToolToGeminiDeclaration,
};
