/** Zona operativa del productor (mercado argentino). */
const TZ_AR = "America/Argentina/Buenos_Aires";

/** Fecha calendario YYYY-MM-DD en Argentina (no usar UTC del servidor). */
const fechaISOArgentina = (fecha = new Date()) =>
  new Date(fecha).toLocaleDateString("en-CA", { timeZone: TZ_AR });

/**
 * Día calendario YYYY-MM-DD en Argentina a partir de un valor típico de PostgreSQL/JS
 * (evita corrimiento UTC en `toISOString().slice(0,10)` con columnas `date`/`timestamptz`).
 */
const fechaCivilArgentinaDesdeValor = (v) => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: TZ_AR });
};

/**
 * Día calendario en Argentina desplazado desde "hoy" local (para mañana / pasado mañana).
 * offsetDias: 1 = mañana, 2 = pasado mañana (respecto de fechaISOArgentina()).
 */
const formatearFechaRelativaArgentina = (offsetDias = 0) => {
  const off = Number(offsetDias);
  if (!Number.isFinite(off) || off < -1 || off > 14) return null;
  const iso = fechaISOArgentina();
  const [y, m, d] = iso.split("-").map(Number);
  const civil = new Date(Date.UTC(y, m - 1, d + off, 15, 0, 0));
  const fmt = new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ_AR,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return fmt.format(civil);
};

module.exports = {
  TZ_AR,
  fechaISOArgentina,
  fechaCivilArgentinaDesdeValor,
  formatearFechaRelativaArgentina,
};
