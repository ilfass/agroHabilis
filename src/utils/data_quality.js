const normalizar = (valor = "") =>
  String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const inferCalidadDesdeFuenteTexto = (fuente = "") => {
  const src = normalizar(fuente);
  if (!src) return { tipo: "sin_datos", detalle: "Sin fuente registrada", score: 0 };
  if (src.includes("ultimo_valido")) return { tipo: "ultimo_valido", detalle: fuente, score: 55 };
  if (src.includes("proxy")) return { tipo: "proxy", detalle: fuente, score: 72 };
  return { tipo: "directa", detalle: fuente, score: 90 };
};

const normalizarFuenteLabel = (fuente = "", { usarUltimoValido = false } = {}) => {
  const raw = String(fuente || "").trim();
  const src = normalizar(raw);
  if (!raw) {
    return usarUltimoValido ? "fallback (ultimo_valido)" : "fallback";
  }

  const base = src.includes("proxy")
    ? raw.includes("(proxy)")
      ? raw
      : `${raw} (proxy)`
    : raw;

  if (!usarUltimoValido) return base;
  return src.includes("ultimo_valido") ? base : `${base} (ultimo_valido)`;
};

module.exports = {
  inferCalidadDesdeFuenteTexto,
  normalizarFuenteLabel,
};
