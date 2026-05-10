/**
 * Registro de hilo completo (entrada + salida) para números listados en CAPTURA_HILO_WHATSAPP.
 * Uso: análisis de calidad, tuning de prompts y entrenamiento supervisado.
 */
const { query } = require("../config/database");

const MAX_NUMEROS_CAPTURA = 32;

let schemaReady = false;

const ensureTabla = async () => {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_interaccion_log (
      id BIGSERIAL PRIMARY KEY,
      whatsapp_norm VARCHAR(24) NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      direccion VARCHAR(3) NOT NULL CHECK (direccion IN ('in', 'out')),
      cuerpo TEXT NOT NULL,
      ruta VARCHAR(96),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    "CREATE INDEX IF NOT EXISTS idx_wa_interaccion_whatsapp_creado ON whatsapp_interaccion_log (whatsapp_norm, creado_en DESC)"
  );
  await query(
    "CREATE INDEX IF NOT EXISTS idx_wa_interaccion_usuario_creado ON whatsapp_interaccion_log (usuario_id, creado_en DESC) WHERE usuario_id IS NOT NULL"
  );
  schemaReady = true;
};

const parseListaCaptura = () => {
  const raw = String(process.env.CAPTURA_HILO_WHATSAPP || "").trim();
  if (!raw) return [];
  const set = new Set();
  for (const part of raw.split(/[,;\s]+/)) {
    const d = part.replace(/\D/g, "");
    if (d.length >= 8) set.add(d);
    if (set.size >= MAX_NUMEROS_CAPTURA) break;
  }
  return [...set];
};

let listaCache = null;
let listaCacheTs = 0;
const TTL_MS = 60_000;

const numerosCaptura = () => {
  const now = Date.now();
  if (listaCache && now - listaCacheTs < TTL_MS) return listaCache;
  listaCache = parseListaCaptura();
  listaCacheTs = now;
  return listaCache;
};

const debeCapturar = (whatsappNorm = "") => {
  const w = String(whatsappNorm || "").replace(/\D/g, "");
  if (!w) return false;
  return numerosCaptura().includes(w);
};

const truncar = (s, max = 120_000) => {
  const t = String(s || "");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…[truncado ${t.length - max} chars]`;
};

const registrar = async ({
  whatsappNorm = "",
  usuarioId = null,
  direccion,
  cuerpo = "",
  ruta = null,
}) => {
  const w = String(whatsappNorm || "").replace(/\D/g, "");
  if (!w || (direccion !== "in" && direccion !== "out")) return;
  if (!debeCapturar(w)) return;
  try {
    await ensureTabla();
    await query(
      `
        INSERT INTO whatsapp_interaccion_log (whatsapp_norm, usuario_id, direccion, cuerpo, ruta)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [w, usuarioId || null, direccion, truncar(cuerpo), ruta ? String(ruta).slice(0, 96) : null]
    );
  } catch (e) {
    console.warn("[CapturaInteraccion]", e.message || e);
  }
};

const registrarFireAndForget = (payload) => {
  void registrar(payload);
};

const borrarPorUsuarioOWhatsapp = async ({ usuarioId = null, whatsappNorm = "" }) => {
  const w = String(whatsappNorm || "").replace(/\D/g, "");
  try {
    await ensureTabla();
    if (usuarioId) {
      await query(`DELETE FROM whatsapp_interaccion_log WHERE usuario_id = $1`, [usuarioId]);
    }
    if (w) {
      await query(`DELETE FROM whatsapp_interaccion_log WHERE whatsapp_norm = $1`, [w]);
    }
  } catch (e) {
    if (e && e.code === "42P01") return;
    throw e;
  }
};

module.exports = {
  debeCapturar,
  registrar,
  registrarFireAndForget,
  borrarPorUsuarioOWhatsapp,
  parseListaCaptura,
  ensureTabla,
};
