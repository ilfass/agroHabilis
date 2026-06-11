"use strict";

const fs = require("fs");
const path = require("path");
const { registerTool } = require("./registry");
const { cursorMode } = require("../cursor_mode");
const { query } = require("../../../config/database");
const { normalizarWhatsapp } = require("../../../models/usuario");

const CONTEXTO_IA_DIR = path.join(__dirname, "../../../../docs/contexto-ia");

const slugSeguro = (raw) => String(raw || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 96);

registerTool({
  name: "agent.workspace_doc",
  description:
    "Lee un fragmento (texto) de un archivo .md bajo docs/contexto-ia/ (material interno tipo skill). Solo nombres de archivo permitidos.",
  parameters: {
    type: "object",
    required: ["slug"],
    properties: {
      slug: {
        type: "string",
        description: "Nombre del archivo sin ruta, ej. guia-respuestas o guia-respuestas.md",
      },
      maxChars: { type: "number", description: "Tope de caracteres (default 3500)" },
    },
  },
  execute: async (_ctx, args) => {
    const slug = slugSeguro(args.slug);
    if (!slug) return { ok: false, error: "slug_vacio" };
    const base = path.basename(slug.endsWith(".md") ? slug : `${slug}.md`);
    const full = path.join(CONTEXTO_IA_DIR, base);
    if (!full.startsWith(CONTEXTO_IA_DIR)) return { ok: false, error: "path_invalido" };
    if (!fs.existsSync(full)) return { ok: false, error: "no_existe", archivo: base };
    const maxChars = Math.min(8000, Math.max(200, Math.floor(Number(args.maxChars) || 3500)));
    const raw = fs.readFileSync(full, "utf8");
    const slice = raw.slice(0, maxChars);
    return { ok: true, archivo: base, chars: slice.length, texto: slice };
  },
});

registerTool({
  name: "agent.workspace_list",
  description:
    "Lista nombres de archivos .md disponibles en docs/contexto-ia/ para luego leer con agent.workspace_doc (elegí slugs relevantes al mensaje del productor).",
  parameters: {
    type: "object",
    properties: {
      maxItems: { type: "number", description: "Máximo de entradas (default 40, tope 80)" },
    },
  },
  execute: async (_ctx, args) => {
    if (!fs.existsSync(CONTEXTO_IA_DIR)) return { ok: false, error: "sin_directorio" };
    const maxItems = Math.min(80, Math.max(5, Math.floor(Number(args.maxItems) || 40)));
    const files = fs
      .readdirSync(CONTEXTO_IA_DIR)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .slice(0, maxItems);
    return { ok: true, slugs: files, total: files.length };
  },
});

registerTool({
  name: "agent.historial_snippet",
  description:
    "Últimas consultas guardadas del mismo WhatsApp en historial_consultas (pregunta/respuesta recortada).",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Cantidad de filas (1-24 según modo; default 3)" },
      maxCharsRespuesta: { type: "number", description: "Recorte por respuesta (default 420)" },
    },
  },
  execute: async (ctx, args) => {
    const waRaw = ctx.numeroWhatsapp;
    if (!waRaw) return { ok: false, error: "sin_whatsapp_en_ctx" };
    const wa = normalizarWhatsapp(String(waRaw));
    const limMax = cursorMode() ? 24 : 8;
    const lim = Math.min(limMax, Math.max(1, Math.floor(Number(args.limit) || 3)));
    const maxR = Math.min(2000, Math.max(80, Math.floor(Number(args.maxCharsRespuesta) || 420)));
    const r = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE whatsapp = $1
        ORDER BY id DESC
        LIMIT $2
      `,
      [wa, lim]
    );
    const filas = (r.rows || []).map((row) => ({
      creado_en: row.creado_en,
      pregunta: String(row.pregunta || "").slice(0, 400),
      respuesta: String(row.respuesta || "").slice(0, maxR),
    }));
    return { ok: true, filas };
  },
});
