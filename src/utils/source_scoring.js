const { inferCalidadDesdeFuenteTexto } = require("./data_quality");

const toDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));

const scoreFreshness = ({ fecha = null, creadoEn = null } = {}) => {
  const ts = toDate(creadoEn) || toDate(fecha);
  if (!ts) return 35;
  const diffMs = Date.now() - ts.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH <= 2) return 100;
  if (diffH <= 6) return 92;
  if (diffH <= 24) return 82;
  if (diffH <= 48) return 68;
  if (diffH <= 7 * 24) return 52;
  return 38;
};

const scorePrecision = ({ mercado = "", mercadoHint = null, cultivoSolicitado = null, cultivoRow = null } = {}) => {
  let score = 60;
  const m = String(mercado || "").toLowerCase();
  const hint = String(mercadoHint || "").toLowerCase();
  if (hint && hint !== "__any_market__") {
    if (m.includes(hint)) score += 35;
    else score -= 20;
  }
  if (cultivoSolicitado && cultivoRow) {
    score += String(cultivoSolicitado).toLowerCase() === String(cultivoRow).toLowerCase() ? 10 : -20;
  }
  return clamp(score);
};

const scoreReliability = ({ fuente = "", mercado = "" } = {}) => {
  const src = String(fuente || mercado || "");
  const q = inferCalidadDesdeFuenteTexto(src);
  let score = Number(q?.score || 55);
  const s = src.toLowerCase();
  const officialHints = [
    "magyp",
    "ministerio",
    "cac",
    "bcr",
    "sio",
    "matba",
    "rofex",
    "mercadoagroganadero",
    "liniers",
    "senasa",
    "ipcva",
  ];
  const isOfficial = officialHints.some((k) => s.includes(k));
  // Regla de negocio: frente a empate de frescura/precisión, priorizar oficial.
  if (isOfficial) score += 18;
  return clamp(score);
};

const scoreRowPriority = (row = {}, opts = {}) => {
  const freshness = scoreFreshness({ fecha: row.fecha, creadoEn: row.creado_en || row.creadoEn });
  const precision = scorePrecision({
    mercado: row.mercado,
    mercadoHint: opts.mercadoHint,
    cultivoSolicitado: opts.cultivoSolicitado,
    cultivoRow: row.cultivo,
  });
  const reliability = scoreReliability({ fuente: row.fuente, mercado: row.mercado });
  // Sube peso de confiabilidad para reflejar prioridad de fuentes oficiales.
  const total = clamp(Math.round(freshness * 0.45 + precision * 0.25 + reliability * 0.3));
  return { freshness, precision, reliability, total };
};

const rankRowsByPriority = (rows = [], opts = {}) =>
  [...rows]
    .map((r) => ({ ...r, _priority: scoreRowPriority(r, opts) }))
    .sort((a, b) => {
      const d = Number(b._priority?.total || 0) - Number(a._priority?.total || 0);
      if (d !== 0) return d;
      return Number(b.precio || 0) - Number(a.precio || 0);
    });

module.exports = {
  scoreRowPriority,
  rankRowsByPriority,
};

