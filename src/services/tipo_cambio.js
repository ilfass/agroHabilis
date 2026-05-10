const { query } = require("../config/database");
const { obtenerTipoCambio } = require("../scrapers/dolar");

const DIAS_VENTANA_DEFAULT = 10;
let _tieneColumnaCompra = null;
let _tieneColumnaFuente = null;

const tieneColumnaCompra = async () => {
  if (_tieneColumnaCompra !== null) return _tieneColumnaCompra;
  const r = await query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tipo_cambio'
        AND column_name = 'compra'
      LIMIT 1
    `
  );
  _tieneColumnaCompra = Boolean(r.rows[0]);
  return _tieneColumnaCompra;
};

const tieneColumnaFuente = async () => {
  if (_tieneColumnaFuente !== null) return _tieneColumnaFuente;
  const r = await query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tipo_cambio'
        AND column_name = 'fuente'
      LIMIT 1
    `
  );
  _tieneColumnaFuente = Boolean(r.rows[0]);
  return _tieneColumnaFuente;
};

/**
 * Último registro por tipo canónico (misma lógica en todo el backend).
 * @param {{ dias?: number }} [opts]
 * @returns {{ fecha: Date|null, items: Array<{tipo:string,valor:number,compra:number|null,fecha:Date|string,fuente:string|null}> }}
 */
const obtenerTipoCambioDia = async (opts = {}) => {
  const dias =
    Number.isFinite(Number(opts.dias)) && Number(opts.dias) > 0 ? Math.min(90, Math.round(Number(opts.dias))) : DIAS_VENTANA_DEFAULT;
  const usarCompra = await tieneColumnaCompra();
  const usarFuente = await tieneColumnaFuente();
  const result = await query(
    `
      SELECT DISTINCT ON (LOWER(tipo))
        tipo,
        valor,
        ${usarCompra ? "compra" : "NULL::numeric AS compra"},
        fecha,
        ${usarFuente ? "fuente" : "NULL::text AS fuente"}
      FROM tipo_cambio
      WHERE fecha >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
      ORDER BY LOWER(tipo), fecha DESC
    `,
    [dias]
  );
  const rows = result.rows || [];
  const mapCanon = new Map();
  for (const r of rows) {
    const t = String(r.tipo || "").toLowerCase();
    const base = { ...r, valor: Number(r.valor), compra: r.compra != null ? Number(r.compra) : null };
    if (t === "bna") {
      if (!mapCanon.has("oficial")) mapCanon.set("oficial", { ...base, tipo: "oficial" });
      continue;
    }
    if (t === "bolsa") {
      if (!mapCanon.has("mep")) mapCanon.set("mep", { ...base, tipo: "mep" });
      continue;
    }
    mapCanon.set(t, { ...base, tipo: t });
  }
  const items = Array.from(mapCanon.values());
  const fechaMs = items.reduce((acc, r) => {
    const f = r?.fecha ? new Date(r.fecha).getTime() : 0;
    return f > acc ? f : acc;
  }, 0);
  return { fecha: fechaMs ? new Date(fechaMs) : null, items };
};

const upsertTipoCambioFila = async ({ tipo, valor, compra, fecha, fuente = "dolarapi" }) => {
  const fuenteStr = String(fuente || "dolarapi").slice(0, 40);
  const usarCompra = await tieneColumnaCompra();
  const usarFuente = await tieneColumnaFuente();
  if (usarCompra && usarFuente) {
    await query(
      `
        INSERT INTO tipo_cambio (tipo, valor, compra, fecha, fuente)
        VALUES ($1, $2, $3, $4::date, $5)
        ON CONFLICT (tipo, fecha) DO UPDATE SET
          valor = EXCLUDED.valor,
          compra = EXCLUDED.compra,
          fuente = EXCLUDED.fuente
      `,
      [String(tipo || "").toLowerCase(), valor, compra, fecha, fuenteStr]
    );
    return;
  }
  if (usarCompra && !usarFuente) {
    await query(
      `
        INSERT INTO tipo_cambio (tipo, valor, compra, fecha)
        VALUES ($1, $2, $3, $4::date)
        ON CONFLICT (tipo, fecha) DO UPDATE SET
          valor = EXCLUDED.valor,
          compra = EXCLUDED.compra
      `,
      [String(tipo || "").toLowerCase(), valor, compra, fecha]
    );
    return;
  }
  if (!usarCompra && usarFuente) {
    await query(
      `
        INSERT INTO tipo_cambio (tipo, valor, fecha, fuente)
        VALUES ($1, $2, $3::date, $4)
        ON CONFLICT (tipo, fecha) DO UPDATE SET
          valor = EXCLUDED.valor,
          fuente = EXCLUDED.fuente
      `,
      [String(tipo || "").toLowerCase(), valor, fecha, fuenteStr]
    );
    return;
  }
  await query(
    `
      INSERT INTO tipo_cambio (tipo, valor, fecha)
      VALUES ($1, $2, $3::date)
      ON CONFLICT (tipo, fecha) DO UPDATE SET
        valor = EXCLUDED.valor
    `,
    [String(tipo || "").toLowerCase(), valor, fecha]
  );
};

/**
 * Inserta solo si no existe (recolector: contar insertados vs ya presentes).
 * @returns {number} rowCount 0 o 1
 */
const insertTipoCambioSiNoExiste = async (item) => {
  if (!item?.tipo || !item?.fecha) return 0;
  const valor = Number(item.venta);
  if (!Number.isFinite(valor)) return 0;
  const compraN = Number(item.compra);
  const compra = Number.isFinite(compraN) && compraN > 0 ? compraN : null;
  const usarCompra = await tieneColumnaCompra();
  const usarFuente = await tieneColumnaFuente();
  const r = usarCompra && usarFuente
    ? await query(
        `
          INSERT INTO tipo_cambio (tipo, valor, compra, fecha, fuente)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (tipo, fecha) DO NOTHING
        `,
        [String(item.tipo || "").toLowerCase(), valor, compra, item.fecha, "dolarapi"]
      )
    : usarCompra && !usarFuente
    ? await query(
        `
          INSERT INTO tipo_cambio (tipo, valor, compra, fecha)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (tipo, fecha) DO NOTHING
        `,
        [String(item.tipo || "").toLowerCase(), valor, compra, item.fecha]
      )
    : !usarCompra && usarFuente
    ? await query(
        `
          INSERT INTO tipo_cambio (tipo, valor, fecha, fuente)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (tipo, fecha) DO NOTHING
        `,
        [String(item.tipo || "").toLowerCase(), valor, item.fecha, "dolarapi"]
      )
    : await query(
        `
          INSERT INTO tipo_cambio (tipo, valor, fecha)
          VALUES ($1, $2, $3)
          ON CONFLICT (tipo, fecha) DO NOTHING
        `,
        [String(item.tipo || "").toLowerCase(), valor, item.fecha]
      );
  return r.rowCount || 0;
};

const persistirTiposCambioDesdeScraper = async (items = [], fuente = "dolarapi") => {
  for (const item of items) {
    const venta = Number(item.venta);
    if (!Number.isFinite(venta)) continue;
    const compraN = Number(item.compra);
    const compra = Number.isFinite(compraN) && compraN > 0 ? compraN : null;
    await upsertTipoCambioFila({
      tipo: item.tipo,
      valor: venta,
      compra,
      fecha: item.fecha,
      fuente,
    });
  }
};

/** Si la última fecha en BD es vieja, trae DolarAPI y hace upsert. */
const asegurarTipoCambioReciente = async () => {
  const fechaR = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
  const ultimaFecha = fechaR.rows[0]?.fecha ? new Date(fechaR.rows[0].fecha) : null;
  const hoy = new Date();
  const dias = ultimaFecha ? (hoy.getTime() - ultimaFecha.getTime()) / 86_400_000 : Infinity;
  if (dias < 1) return;
  try {
    const vivo = await obtenerTipoCambio();
    await persistirTiposCambioDesdeScraper(vivo, "dolarapi");
  } catch (error) {
    console.warn("[TipoCambio] No se pudo refrescar tipo de cambio:", error.message);
  }
};

module.exports = {
  obtenerTipoCambioDia,
  upsertTipoCambioFila,
  insertTipoCambioSiNoExiste,
  persistirTiposCambioDesdeScraper,
  asegurarTipoCambioReciente,
};
