const axios = require("axios");
const { query } = require("../config/database");
const { obtenerPreciosCAC } = require("../scrapers/granos_cac");
const { obtenerTipoCambio } = require("../scrapers/dolar");
const { obtenerClima } = require("../scrapers/clima");
const { PLAN_SCHEMA } = require("./plans.schema");
const { resolverPlanEfectivo } = require("../services/planes");
const { persistirTiposCambioDesdeScraper } = require("../services/tipo_cambio");
let _tieneCompraTipoCambio = null;
let _tieneFuenteTipoCambio = null;
let _tieneFuentePrecios = null;
let _tieneActualizadoEnPrecios = null;

const tieneCompraTipoCambio = async () => {
  if (_tieneCompraTipoCambio !== null) return _tieneCompraTipoCambio;
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
  _tieneCompraTipoCambio = Boolean(r.rows[0]);
  return _tieneCompraTipoCambio;
};

const tieneFuenteTipoCambio = async () => {
  if (_tieneFuenteTipoCambio !== null) return _tieneFuenteTipoCambio;
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
  _tieneFuenteTipoCambio = Boolean(r.rows[0]);
  return _tieneFuenteTipoCambio;
};

const tieneFuentePrecios = async () => {
  if (_tieneFuentePrecios !== null) return _tieneFuentePrecios;
  const r = await query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'precios'
        AND column_name = 'fuente'
      LIMIT 1
    `
  );
  _tieneFuentePrecios = Boolean(r.rows[0]);
  return _tieneFuentePrecios;
};

const tieneActualizadoEnPrecios = async () => {
  if (_tieneActualizadoEnPrecios !== null) return _tieneActualizadoEnPrecios;
  const r = await query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'precios'
        AND column_name = 'actualizado_en'
      LIMIT 1
    `
  );
  _tieneActualizadoEnPrecios = Boolean(r.rows[0]);
  return _tieneActualizadoEnPrecios;
};

/** Ordenar por última ingesta cuando exista columna actualizado_en (misma migración que fuente granular). */
const sqlOrdenRecenciaPrecios = async () =>
  (await tieneActualizadoEnPrecios())
    ? "COALESCE(actualizado_en, creado_en) DESC NULLS LAST"
    : "creado_en DESC NULLS LAST";

const formatearPrecio = (numero) => {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "s/d";
  return `$${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)}`;
};

const formatearUSD = (numero) => {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "s/d";
  return `USD ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n)}`;
};

const variacion = (actual, anterior) => {
  const a = Number(actual);
  const b = Number(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return "→ sin cambios";
  const pct = Number((((a - b) / b) * 100).toFixed(1));
  if (pct > 0) return `▲ +${pct}%`;
  if (pct < 0) return `▼ ${pct}%`;
  return "→ sin cambios";
};

const esFresco = (fecha, maxHoras = 4) => {
  if (!fecha) return false;
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return false;
  const diffMs = Date.now() - d.getTime();
  return diffMs <= maxHoras * 60 * 60 * 1000;
};

const normalizar = (t = "") =>
  String(t)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Prioridad de presentación: oficial primero, luego blue / bolsa (MEP) / CCL, resto al final. */
const PRIORIDAD_TIPO_CAMBIO = ["oficial", "blue", "bolsa", "ccl", "mep", "exportacion", "dolar_soja"];

const ordenarItemsTipoCambio = (items = []) => {
  const rank = (tipo) => {
    const t = normalizar(String(tipo || ""));
    const i = PRIORIDAD_TIPO_CAMBIO.indexOf(t);
    return i === -1 ? 100 : i;
  };
  return [...(items || [])].sort((a, b) => {
    const ra = rank(a.tipo);
    const rb = rank(b.tipo);
    if (ra !== rb) return ra - rb;
    return String(a.tipo || "").localeCompare(String(b.tipo || ""));
  });
};

/** FOB / export: no debe ser la referencia principal para “¿cuánto cobro?” si hay disponible más reciente. */
const esRowProbableFOB = (row) => {
  const blob = `${normalizar(String(row?.mercado || ""))} ${normalizar(String(row?.fuente || ""))} ${normalizar(String(row?.tipo_precio || ""))}`;
  return /\bfob\b|monitor_fob|_fob\b|precio_export|magyp.*fob/i.test(blob);
};

const clasificarTipoFuentePrecio = (row = {}) => {
  const mercado = normalizar(String(row?.mercado || ""));
  const fuente = normalizar(String(row?.fuente || ""));
  const tipoPrecio = normalizar(String(row?.tipo_precio || ""));
  const blob = `${mercado} ${fuente} ${tipoPrecio}`;

  const esFob = /\bfob\b|export/.test(blob);
  const esInstitucional = /\bcac\b|camara|c[aá]mara|arbitral|magyp|pizarra/.test(blob);

  if (esFob) {
    return {
      tipoFuente: "exportacion",
      tipoEtiqueta: "FOB oficial / exportación",
      condicionComercial: "valor FOB puerto (no equivale al neto campo)",
    };
  }
  if (esInstitucional) {
    return {
      tipoFuente: "institucional",
      tipoEtiqueta: "Precio cámara / institucional",
      condicionComercial: "referencia arbitral o promedio (no siempre negociable hoy)",
    };
  }
  return {
    tipoFuente: "mercado_fisico",
    tipoEtiqueta: "Disponible / mercado físico",
    condicionComercial: "entrega inmediata o cercana",
  };
};

/** Texto para el usuario (evita “bd” como única etiqueta si hay plaza/mercado en fila). */
const fuenteLegibleParaPrecio = (row = {}) => {
  const fRaw = String(row?.fuente || "").trim();
  if (/^vivo_cac$/i.test(fRaw)) return "CAC Rosario (consulta en tiempo real)";
  const mapa = {
    cac_bcr: "Cámara de Cereales — BCR (pizarra Rosario)",
    magyp_fob: "MAGYP — precios FOB exportación",
    afa_scl: "AFA San Cristóbal — mercados en línea",
    sio_granos: "SIO Granos — operaciones (MAGYP)",
    matba_rofex: "MATBA-Rofex — futuros",
    mercados_web: "Referencia web de mercados",
    ingesta: "Ingesta automática AgroHabilis",
    precios_norm: "Tabla normalizada de mercado",
    bcr_boletin: "Boletín BCR (mínimos)",
    seed_bcr_gix: "Semilla de referencia BCR (arranque)",
    seed_lncampo: "Semilla LN Campo (arranque)",
    legacy: "Dato histórico en base",
  };
  const fLow = fRaw.toLowerCase();
  if (mapa[fLow]) return mapa[fLow];
  if (/^reuso_/i.test(fRaw)) return "Reuso de última cotización válida";
  if (fRaw && !/^(bd|bd_stale|bd_ultimo)$/i.test(fRaw)) return fRaw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  const m = String(row?.mercado || "").trim();
  if (m) return m.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return "Base Agrohabilis";
};

const enriquecerFilaPrecioChatbot = (row) => {
  if (!row || row.precio == null) return row;
  const clasificacion_precio = clasificarTipoFuentePrecio(row);
  const fuente_mostrar = fuenteLegibleParaPrecio(row);
  return {
    ...row,
    clasificacion_precio,
    fuente_mostrar,
  };
};

/** Dentro del top por fecha/BDR, elegir primera fila que no sea FOB; si solo hay FOB, devolver la más nueva. */
const elegirPrecioPreferDisponible = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const noFob = rows.filter((r) => !esRowProbableFOB(r));
  return noFob.length ? noFob[0] : rows[0];
};

/**
 * valor = precio de venta del USD (ARS por 1 USD) típico "comprador" de dólares del público.
 * compra = precio de compra del USD cuando existe (vendedor de USD / casa compra tus dólares).
 */
const formatearItemTipoCambioTexto = (x) => {
  const tipoRaw = normalizar(String(x?.tipo || ""));
  const tipo = tipoRaw === "bolsa" ? "MEP" : String(x?.tipo || "").toUpperCase();
  const c = Number(x?.compra);
  const v = Number(x?.valor);
  const fc = Number.isFinite(c) && c > 0;
  const fv = Number.isFinite(v) && v > 0;
  let f = "s/d";
  if (x?.fecha) {
    if (typeof x.fecha === "string") {
      const s = x.fecha.slice(0, 10);
      f = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s;
    } else {
      const d = x.fecha instanceof Date ? x.fecha : new Date(x.fecha);
      if (!Number.isNaN(d.getTime())) f = d.toISOString().slice(0, 10);
      else f = String(x.fecha).slice(0, 10);
    }
  }
  if (fc && fv) {
    return `${tipo} compra ${formatearPrecio(c)} / venta ${formatearPrecio(v)} (${f})`;
  }
  if (fv) return `${tipo}: ${formatearPrecio(v)} (${f})`;
  return `${tipo}: s/d (${f})`;
};

/** CAC Rosario: solo granos con cotización fiable; hortícolas u otros no deben matchear por substring. */
const CULTIVOS_PRECIO_DESDE_CAC = new Set(["soja", "maiz", "trigo", "girasol", "sorgo", "cebada", "papa"]);

const obtenerPrecioFresco = async (cultivo, maxHoras = 4) => {
  const cultivoNorm = normalizar(cultivo);
  const ordRec = await sqlOrdenRecenciaPrecios();
  const hf = await tieneFuentePrecios();
  const ordenPrioridad = hf
    ? `
        CASE
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%fob%' OR LOWER(COALESCE(fuente, '')) LIKE '%fob%' THEN 3
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%cac%' OR LOWER(COALESCE(mercado, '')) LIKE '%camara%' OR LOWER(COALESCE(fuente, '')) LIKE '%magyp%' THEN 2
          ELSE 1
        END`
    : `
        CASE
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%fob%' THEN 3
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%cac%' OR LOWER(COALESCE(mercado, '')) LIKE '%camara%' OR LOWER(COALESCE(mercado, '')) LIKE '%magyp%' THEN 2
          ELSE 1
        END`;
  const selFuente = hf ? "fuente" : "NULL::text AS fuente";
  const local = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha, tipo_precio, ${selFuente}
      FROM precios
      WHERE LOWER(cultivo) = $1
      ORDER BY
        fecha DESC,
        ${ordenPrioridad},
        CASE
          WHEN LOWER(COALESCE(tipo_precio, '')) IN ('operacion_real', 'oferta') THEN 0
          ELSE 1
        END,
        ${ordRec}
      LIMIT 15
    `,
    [cultivoNorm]
  );
  const row = elegirPrecioPreferDisponible(local.rows);
  const conStale = (r) =>
    enriquecerFilaPrecioChatbot({
      ...r,
      fuente: r.fuente && String(r.fuente).trim() ? r.fuente : "bd_stale",
    });

  if (row && esFresco(row.fecha, maxHoras)) {
    return enriquecerFilaPrecioChatbot({ ...row });
  }

  if (!CULTIVOS_PRECIO_DESDE_CAC.has(cultivoNorm)) {
    return row ? conStale(row) : null;
  }
  const cac = await obtenerPreciosCAC();
  const hit = cac.find((x) => normalizar(x.cultivo).includes(cultivoNorm));
  if (!hit) return row ? conStale(row) : null;

  const precio = Number.isFinite(Number(hit.precio_ars)) ? Number(hit.precio_ars) : Number(hit.precio_usd);
  const moneda = Number.isFinite(Number(hit.precio_ars)) ? "ARS" : "USD";
  await query(
    `
      INSERT INTO precios (cultivo, mercado, precio, moneda, fecha, fuente)
      VALUES ($1, $2, $3, $4, $5, 'vivo_cac')
      ON CONFLICT (cultivo, mercado, fecha, fuente)
      DO UPDATE SET
        precio = EXCLUDED.precio,
        moneda = EXCLUDED.moneda,
        actualizado_en = NOW()
    `,
    [hit.cultivo, hit.mercado || "rosario_cac", precio, moneda, hit.fecha]
  );
  return enriquecerFilaPrecioChatbot({
    cultivo: hit.cultivo,
    mercado: hit.mercado || "rosario_cac",
    precio,
    moneda,
    fecha: hit.fecha,
    fuente: "vivo_cac",
  });
};

/**
 * Última cotización en `precios` sin ventana de “frescura” ni scrape CAC.
 * Usar cuando `obtenerPrecioFresco` no devuelve fila útil (ventana corta, API caída, etc.).
 */
const obtenerUltimoPrecioCultivoDesdeBd = async (cultivo) => {
  const cultivoNorm = normalizar(cultivo);
  const ordRec = await sqlOrdenRecenciaPrecios();
  const hf = await tieneFuentePrecios();
  const ordenPrioridad = hf
    ? `
        CASE
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%fob%' OR LOWER(COALESCE(fuente, '')) LIKE '%fob%' THEN 3
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%cac%' OR LOWER(COALESCE(mercado, '')) LIKE '%camara%' OR LOWER(COALESCE(fuente, '')) LIKE '%magyp%' THEN 2
          ELSE 1
        END`
    : `
        CASE
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%fob%' THEN 3
          WHEN LOWER(COALESCE(mercado, '')) LIKE '%cac%' OR LOWER(COALESCE(mercado, '')) LIKE '%camara%' OR LOWER(COALESCE(mercado, '')) LIKE '%magyp%' THEN 2
          ELSE 1
        END`;
  const selFuente = hf ? "fuente" : "NULL::text AS fuente";
  const local = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha, tipo_precio, ${selFuente}
      FROM precios
      WHERE LOWER(cultivo) = $1
      ORDER BY
        fecha DESC,
        ${ordenPrioridad},
        CASE
          WHEN LOWER(COALESCE(tipo_precio, '')) IN ('operacion_real', 'oferta') THEN 0
          ELSE 1
        END,
        ${ordRec}
      LIMIT 15
    `,
    [cultivoNorm]
  );
  const row = elegirPrecioPreferDisponible(local.rows);
  if (!row || !Number.isFinite(Number(row.precio)) || Number(row.precio) <= 0) return null;
  return enriquecerFilaPrecioChatbot({
    ...row,
    fuente: row.fuente && String(row.fuente).trim() ? String(row.fuente) : "bd_ultimo",
  });
};

/**
 * Cotización más reciente FOB/exportación en BD para el mismo cultivo.
 * Solo para línea complementaria cuando el precio principal ya es disponible / mercado físico
 * y el usuario debe ver aparte una referencia exportación (sin mezclarla con campo).
 */
const obtenerPrecioComplementarioFob = async (cultivo, precioPrincipal = null) => {
  const cultivoNorm = normalizar(cultivo);
  if (!cultivoNorm) return null;

  if (precioPrincipal) {
    const clfMain = clasificarTipoFuentePrecio(precioPrincipal);
    if (clfMain.tipoFuente === "exportacion") return null;
    if (clfMain.tipoFuente !== "mercado_fisico") return null;
  }

  const hf = await tieneFuentePrecios();
  const ordRec = await sqlOrdenRecenciaPrecios();
  const selFuente = hf ? "fuente" : "NULL::text AS fuente";
  const local = await query(
    `
      SELECT cultivo, mercado, precio, moneda, fecha, tipo_precio, ${selFuente}
      FROM precios
      WHERE LOWER(cultivo) = $1
      ORDER BY fecha DESC, ${ordRec}
      LIMIT 48
    `,
    [cultivoNorm]
  );

  let hit = (local.rows || []).find((r) => esRowProbableFOB(r));
  if (!hit) return null;
  hit = enriquecerFilaPrecioChatbot(hit);
  if (hit?.clasificacion_precio?.tipoFuente !== "exportacion") return null;

  if (precioPrincipal) {
    const m1 = normalizar(String(precioPrincipal.mercado || ""));
    const m2 = normalizar(String(hit.mercado || ""));
    const f1 = String(precioPrincipal.fecha || "").slice(0, 10);
    const f2 = String(hit.fecha || "").slice(0, 10);
    const p1 = Number(precioPrincipal.precio);
    const p2 = Number(hit.precio);
    const monSame = String(precioPrincipal.moneda || "").toUpperCase() === String(hit.moneda || "").toUpperCase();
    if (m1 && m2 && m1 === m2 && f1 === f2 && monSame && Number.isFinite(p1) && Number.isFinite(p2) && p1 === p2) {
      return null;
    }
  }

  return hit;
};

const obtenerDolarFresco = async (maxHoras = 2) => {
  const usarCompra = await tieneCompraTipoCambio();
  const usarFuente = await tieneFuenteTipoCambio();
  const local = await query(
    `
      SELECT DISTINCT ON (LOWER(tipo))
        tipo,
        valor,
        ${usarCompra ? "compra" : "NULL::numeric AS compra"},
        fecha,
        ${usarFuente ? "fuente" : "NULL::text AS fuente"}
      FROM tipo_cambio
      ORDER BY LOWER(tipo), fecha DESC
    `
  );
  const latest = local.rows[0];
  if (latest && esFresco(latest.fecha, maxHoras)) {
    return { items: ordenarItemsTipoCambio(local.rows), fuente: "bd" };
  }
  const vivo = await obtenerTipoCambio();
  await persistirTiposCambioDesdeScraper(vivo, "dolarapi");
  const items = ordenarItemsTipoCambio(
    vivo.map((x) => ({
      tipo: x.tipo,
      valor: Number(x.venta),
      compra: Number.isFinite(Number(x.compra)) && Number(x.compra) > 0 ? Number(x.compra) : null,
      fecha: x.fecha,
      fuente: "dolarapi",
    }))
  );
  return {
    items,
    fuente: "vivo_dolarapi",
  };
};

/**
 * Pronóstico 7 días: cache por coordenadas. La frescura se mide con MAX(creado_en), no con la
 * fecha del último día del pronóstico (fechas futuras rompían esFresco y bloqueaban el refresh).
 */
const obtenerClimaFresco = async (lat, lng, maxHoras = 3) => {
  const local = await query(
    `
      SELECT fecha, temp_min, temp_max, precipitacion, helada, descripcion
      FROM clima
      WHERE ABS(lat - $1::numeric) < 0.15
        AND ABS(lng - $2::numeric) < 0.15
      ORDER BY fecha ASC
      LIMIT 7
    `,
    [lat, lng]
  );
  const fresh = await query(
    `
      SELECT MAX(creado_en) AS ultimo
      FROM clima
      WHERE ABS(lat - $1::numeric) < 0.15
        AND ABS(lng - $2::numeric) < 0.15
    `,
    [lat, lng]
  );
  const ultimo = fresh.rows[0]?.ultimo;
  if (local.rows.length && ultimo && esFresco(ultimo, maxHoras)) {
    return { items: local.rows, fuente: "bd" };
  }
  const vivo = await obtenerClima(lat, lng);
  for (const item of vivo) {
    await query(
      `
        INSERT INTO clima (lat, lng, fecha, temp_min, temp_max, precipitacion, helada, descripcion, creado_en)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
        ON CONFLICT (lat, lng, fecha) DO UPDATE SET
          temp_min = EXCLUDED.temp_min,
          temp_max = EXCLUDED.temp_max,
          precipitacion = EXCLUDED.precipitacion,
          helada = EXCLUDED.helada,
          descripcion = EXCLUDED.descripcion,
          creado_en = NOW()
      `,
      [lat, lng, item.fecha, item.temp_min, item.temp_max, item.precipitacion, item.helada, item.descripcion]
    );
  }
  return { items: vivo, fuente: "vivo_openmeteo" };
};

const obtenerNoticiasFrescas = async (categorias = [], limite = 3) => {
  const keys = categorias.map((k) => normalizar(k)).filter(Boolean);
  const noticias = await query(
    `
      SELECT fuente, categoria, titulo, resumen, url, publicado_en
      FROM noticias_agro
      WHERE COALESCE(publicado_en, creado_en) >= NOW() - INTERVAL '24 hours'
      ORDER BY COALESCE(publicado_en, creado_en) DESC
      LIMIT 50
    `
  );
  const ranked = (noticias.rows || [])
    .map((n) => {
      const t = normalizar(n.titulo);
      const match = keys.some((k) => t.includes(k));
      const score = (match ? 2 : 0) + (/(agro|campo|ganad|hacienda|grano|maiz|soja|trigo)/.test(t) ? 1 : 0);
      return { ...n, score };
    })
    .filter((n) => n.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, limite).map((n) => ({
    fuente: n.fuente,
    categoria: n.categoria,
    titulo: n.titulo,
    resumen: n.resumen,
    url: n.url,
    publicado_en: n.publicado_en,
  }));
};

const separador = () => "━━━━━━━━━━━━━━━━━━━━━━━";

/** Plan efectivo (incluye trial Básico vía plan_activo_hasta), alineado con services/planes.js */
const resolverPlan = (usuario = {}) =>
  resolverPlanEfectivo({
    plan: usuario?.plan,
    planActivoHasta: usuario?.plan_activo_hasta ?? usuario?.planActivoHasta ?? null,
  });

const configPlan = (usuario = {}) => {
  const plan = resolverPlan(usuario);
  const cfg = PLAN_SCHEMA[plan] || PLAN_SCHEMA.gratis;
  return {
    plan,
    bloques: cfg.bloques,
    precio: cfg.precio,
    permitidos: cfg.permitidos,
    prohibidos: cfg.prohibidos,
  };
};

const aplicarReglasPlanMensaje = (mensaje = "", usuario = {}) => {
  const plan = resolverPlan(usuario);
  let out = String(mensaje || "");
  // Gratis/Básico no deben ver bloques PRO.
  if (plan !== "pro") {
    out = out
      .replace(/\n?🧠 \*INSIGHTS PRO[\s\S]*?(?=\n(?:📌|\u{1F6D1}|$))/gu, "\n")
      .replace(/\n?🧪 \*ESCENARIOS RÁPIDOS \(PRO\)[\s\S]*?(?=\n(?:📌|\u{1F6D1}|$))/gu, "\n")
      .replace(/\n?⛽ \*TERMÓMETRO OPERATIVO \(PRO\)[\s\S]*?(?=\n(?:📌|\u{1F6D1}|$))/gu, "\n")
      .replace(/\n?🔔 \*ALERTAS SUGERIDAS \(PRO\)[\s\S]*?(?=\n(?:📌|\u{1F6D1}|$))/gu, "\n");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
};

const quitarSeccion = (texto = "", titulo = "") => {
  if (!titulo) return texto;
  const safe = titulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n?${safe}[\\s\\S]*?(?=\\n(?:📊|💰|💵|🌤️|🔎|📌|🛑|━━━━━━━━|$))`, "gu");
  return String(texto || "").replace(re, "\n");
};

const aplicarLayoutPlanEstricto = (mensaje = "", usuario = {}) => {
  const plan = resolverPlan(usuario);
  let out = aplicarReglasPlanMensaje(mensaje, usuario);
  if (plan === "gratis") {
    out = quitarSeccion(out, "💰 *TU CAMPAÑA*");
    out = quitarSeccion(out, "🐄 *TU HACIENDA*");
    out = quitarSeccion(out, "🎯 *OPORTUNIDAD DE VENTA (48/72h)*");
    out = quitarSeccion(out, "⚠️ *RIESGOS OPERATIVOS (SEMANA)*");
  }
  if (plan === "basico") {
    out = quitarSeccion(out, "💰 *TU CAMPAÑA*");
    out = quitarSeccion(out, "🐄 *TU HACIENDA*");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
};

/**
 * Filas granulares (plaza / condición / tipo_registro) desde `precios_normalizados`.
 * Vacío si falta la tabla o la migración; no interrumpe el flujo del bot.
 */
const listarPreciosNormalizadosParaCultivo = async (cultivo, fechaDesdeIso, maxItems = 20) => {
  const c = normalizar(cultivo);
  if (!c || !fechaDesdeIso) return [];
  const lim = Math.min(48, Math.max(4, Number(maxItems) || 20));
  try {
    const r = await query(
      `
        SELECT producto AS cultivo,
               precio::float8 AS precio,
               moneda,
               fecha_mercado AS fecha,
               fuente,
               mercado,
               plaza,
               condicion,
               tipo_registro
        FROM precios_normalizados
        WHERE LOWER(producto) = $1
          AND fecha_mercado >= $2::date
        ORDER BY fecha_mercado DESC, timestamp_origen DESC NULLS LAST
        LIMIT $3
      `,
      [c, String(fechaDesdeIso).slice(0, 10), lim]
    );
    return (r.rows || []).map((row) => {
      const parts = [row.mercado, row.plaza, row.condicion, row.tipo_registro].filter(Boolean);
      return {
        cultivo: row.cultivo,
        mercado: parts.join(" · ") || row.mercado || "precios_norm",
        precio: row.precio,
        moneda: row.moneda,
        fecha: row.fecha,
        fuente: row.fuente && String(row.fuente).trim() ? String(row.fuente) : "precios_norm",
      };
    });
  } catch (e) {
    if (e && e.code === "42P01") return [];
    throw e;
  }
};

const bloquePlanPlantilla = (usuario = {}, extra = "") => {
  const cfg = configPlan(usuario);
  const planTxt = cfg.plan.toUpperCase();
  return [
    separador(),
    `📦 *PLANTILLA ${planTxt}*`,
    separador(),
    `Incluye ${cfg.bloques} bloques activos en este mensaje. Precio: ${cfg.precio}.`,
    extra || "",
  ]
    .filter(Boolean)
    .join("\n");
};

module.exports = {
  formatearPrecio,
  formatearUSD,
  variacion,
  esFresco,
  clasificarTipoFuentePrecio,
  fuenteLegibleParaPrecio,
  enriquecerFilaPrecioChatbot,
  obtenerPrecioFresco,
  obtenerUltimoPrecioCultivoDesdeBd,
  obtenerPrecioComplementarioFob,
  tieneFuentePrecios,
  tieneActualizadoEnPrecios,
  listarPreciosNormalizadosParaCultivo,
  obtenerDolarFresco,
  ordenarItemsTipoCambio,
  formatearItemTipoCambioTexto,
  obtenerClimaFresco,
  obtenerNoticiasFrescas,
  separador,
  resolverPlan,
  configPlan,
  aplicarReglasPlanMensaje,
  aplicarLayoutPlanEstricto,
  bloquePlanPlantilla,
};
