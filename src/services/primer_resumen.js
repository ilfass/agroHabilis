const axios = require("axios");
const { query } = require("../config/database");
const { actualizarUsuario } = require("../models/usuario");
const { generarConPromptLibre } = require("./gemini");
const { resolverPlanEfectivo } = require("./planes");
const { ejecutarRecolectorDiario } = require("../jobs/recolector");
const { obtenerMercadosWeb } = require("../scrapers/mercados_web");
const { obtenerClima } = require("../scrapers/clima");

const MESES = {
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

const normalizarTexto = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const normalizarCultivo = (txt = "") => {
  const t = normalizarTexto(txt);
  if (!t) return null;
  if (t.includes("soja")) return "soja";
  if (t.includes("maiz")) return "maiz";
  if (t.includes("trigo")) return "trigo";
  if (t.includes("girasol")) return "girasol";
  if (t.includes("sorgo")) return "sorgo";
  if (t.includes("cebada")) return "cebada";
  if (t.includes("papa") || t.includes("patata")) return "papa";
  if (t.includes("ganader") || t.includes("hacienda")) return null;
  return t;
};

const etiquetaCultivo = (cultivo = "") => {
  const c = normalizarCultivo(cultivo) || normalizarTexto(cultivo);
  if (c === "maiz") return "Maíz";
  if (c === "soja") return "Soja";
  if (c === "trigo") return "Trigo";
  if (c === "girasol") return "Girasol";
  if (c === "sorgo") return "Sorgo";
  if (c === "cebada") return "Cebada";
  if (c === "papa") return "Papa";
  return cultivo;
};

const formatearNumero = (n, dec = 0) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "s/d";
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(v);
};

const formatearFechaCorta = (f) =>
  new Date(f).toLocaleDateString("es-AR", {
    weekday: "long",
    timeZone: "America/Argentina/Buenos_Aires",
  });

const formatearFechaCortaNumerica = (f) => {
  if (!f) return "s/d";
  return new Date(f).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
};

const geocodificarZona = async ({ partido, provincia }) => {
  if (!partido || !provincia) return null;
  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q: `${partido}, ${provincia}, Argentina`,
      format: "json",
      limit: 1,
    },
    timeout: 30000,
    headers: {
      "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)",
    },
    validateStatus: (s) => s === 200,
  });
  const row = Array.isArray(response.data) ? response.data[0] : null;
  if (!row) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const asegurarGeoUsuario = async (usuario) => {
  if (!usuario) return usuario;
  if (usuario.lat !== null && usuario.lng !== null) return usuario;
  try {
    const geo = await geocodificarZona({
      partido: usuario.partido,
      provincia: usuario.provincia,
    });
    if (!geo) return usuario;
    const actualizado = await actualizarUsuario(usuario.id, geo);
    return {
      ...usuario,
      lat: actualizado?.lat ?? geo.lat,
      lng: actualizado?.lng ?? geo.lng,
    };
  } catch (error) {
    console.warn("[PrimerResumen] No se pudo geocodificar:", error.message);
    return usuario;
  }
};

const obtenerPerfilCompleto = async (usuarioId) => {
  const userResult = await query(
    `
      SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real, provincia, partido, lat, lng, plan, plan_activo_hasta, noticias_cantidad_pref
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const usuario = userResult.rows[0];
  if (!usuario) return null;

  const cultivosResult = await query(
    `
      SELECT cultivo
      FROM usuario_cultivos
      WHERE usuario_id = $1 AND activo = true
      ORDER BY cultivo
    `,
    [usuarioId]
  );

  const perfilResult = await query(
    `
      SELECT tipo
      FROM perfil_productivo
      WHERE usuario_id = $1 AND activo = true
      ORDER BY id DESC
      LIMIT 1
    `,
    [usuarioId]
  );

  return {
    ...usuario,
    cultivos: cultivosResult.rows.map((r) => r.cultivo),
    perfil_productivo: perfilResult.rows[0]?.tipo || "agricultura",
  };
};

const obtenerPerfilGanaderoUsuario = async (usuarioId) => {
  const result = await query(
    `
      SELECT especie, categoria, cantidad_estimada
      FROM usuario_ganaderia_perfil
      WHERE usuario_id = $1 AND activo = true
      ORDER BY especie, categoria
    `,
    [usuarioId]
  );
  return result.rows || [];
};

const limiteZonasPorPlan = (planEfectivo = "gratis") => {
  if (planEfectivo === "pro") return 6;
  if (planEfectivo === "basico") return 3;
  return 1;
};

const obtenerZonasUsuario = async ({ usuarioId, perfil, limite }) => {
  const out = [];
  const seen = new Set();
  const pushZona = (z) => {
    const partido = String(z?.partido || "").trim();
    const provincia = String(z?.provincia || "").trim();
    if (!partido || !provincia) return;
    const key = `${normalizarTexto(provincia)}|${normalizarTexto(partido)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      partido,
      provincia,
      lat: Number(z?.lat),
      lng: Number(z?.lng),
    });
  };

  const r = await query(
    `
      SELECT provincia, partido, lat, lng, prioridad
      FROM usuario_zonas
      WHERE usuario_id = $1 AND activa = true
      ORDER BY prioridad ASC, id ASC
    `,
    [usuarioId]
  );
  for (const z of r.rows || []) pushZona(z);
  pushZona(perfil);
  return out.slice(0, limite);
};

const obtenerDisponiblePorCultivo = async (cultivos = []) => {
  if (!cultivos.length) return [];
  const result = await query(
    `
      WITH ultima_por_cultivo AS (
        SELECT LOWER(cultivo) AS cultivo_norm, MAX(fecha) AS fecha
        FROM precios
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY LOWER(cultivo)
      ),
      ranked AS (
        SELECT
          p.cultivo,
          p.mercado,
          p.precio,
          p.moneda,
          p.fecha,
          ROW_NUMBER() OVER (
            PARTITION BY LOWER(p.cultivo)
            ORDER BY
              CASE
                WHEN LOWER(p.mercado) LIKE '%rosario%' THEN 0
                WHEN LOWER(p.mercado) LIKE '%afa%' THEN 1
                WHEN LOWER(p.mercado) LIKE '%cac%' THEN 2
                ELSE 3
              END,
              CASE WHEN p.moneda = 'USD' THEN 0 ELSE 1 END,
              p.precio DESC
          ) AS rn
        FROM precios p
        JOIN ultima_por_cultivo u
          ON LOWER(p.cultivo) = u.cultivo_norm
         AND p.fecha = u.fecha
        WHERE LOWER(p.cultivo) = ANY($1::text[])
      )
      SELECT cultivo, mercado, precio, moneda, fecha
      FROM ranked
      WHERE rn = 1
      ORDER BY cultivo
    `,
    [cultivos.map((c) => normalizarTexto(c))]
  );
  return result.rows;
};

const completarDisponibleConWebFallback = async ({ cultivos = [], disponible = [] }) => {
  const existentes = new Set((disponible || []).map((x) => normalizarTexto(x.cultivo)));
  const faltantes = cultivos.filter((c) => !existentes.has(normalizarTexto(c)));
  if (!faltantes.length) return disponible;
  try {
    const mercados = await obtenerMercadosWeb();
    const extras = [];
    for (const cultivo of faltantes) {
      const item = (mercados.items || []).find((m) => normalizarTexto(m.cultivo) === normalizarTexto(cultivo));
      if (!item) continue;
      const moneda = Number.isFinite(Number(item.precio_usd)) ? "USD" : "ARS";
      const precio = moneda === "USD" ? Number(item.precio_usd) : Number(item.precio_ars);
      if (!Number.isFinite(precio) || precio <= 0) continue;
      extras.push({
        cultivo,
        mercado: item.mercado || "WEB",
        precio,
        moneda,
        fecha: item.fecha,
      });
    }
    return [...disponible, ...extras];
  } catch (_error) {
    return disponible;
  }
};

const obtenerEstadoDisponibilidadCultivos = async (cultivos = []) => {
  if (!cultivos.length) return new Map();
  const result = await query(
    `
      WITH input AS (
        SELECT unnest($1::text[]) AS cultivo_norm
      ),
      ult AS (
        SELECT DISTINCT ON (LOWER(p.cultivo))
          LOWER(p.cultivo) AS cultivo_norm,
          p.fecha,
          p.mercado,
          p.precio,
          p.moneda
        FROM precios p
        WHERE LOWER(p.cultivo) = ANY($1::text[])
        ORDER BY LOWER(p.cultivo), p.fecha DESC
      ),
      hoy AS (
        SELECT LOWER(cultivo) AS cultivo_norm, COUNT(*)::int AS total_hoy
        FROM precios
        WHERE fecha = CURRENT_DATE
          AND LOWER(cultivo) = ANY($1::text[])
        GROUP BY LOWER(cultivo)
      )
      SELECT
        i.cultivo_norm,
        COALESCE(h.total_hoy, 0) AS total_hoy,
        u.fecha AS ultima_fecha,
        u.mercado AS ultimo_mercado,
        u.precio AS ultimo_precio,
        u.moneda AS ultima_moneda
      FROM input i
      LEFT JOIN ult u ON u.cultivo_norm = i.cultivo_norm
      LEFT JOIN hoy h ON h.cultivo_norm = i.cultivo_norm
    `,
    [cultivos.map((c) => normalizarTexto(c))]
  );
  const map = new Map();
  for (const r of result.rows) {
    map.set(r.cultivo_norm, {
      tieneHoy: Number(r.total_hoy) > 0,
      ultimaFecha: r.ultima_fecha || null,
      ultimoMercado: r.ultimo_mercado || null,
      ultimoPrecio: Number(r.ultimo_precio),
      ultimaMoneda: r.ultima_moneda || null,
    });
  }
  return map;
};

const parsePosicionMes = (posicion = "") => {
  const t = normalizarTexto(posicion).replace(/\s+/g, "");
  const match = t.match(/(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(\d{2,4})/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const mes = MESES[match[1]] || 12;
  const y = Number(match[2]);
  const year = y < 100 ? 2000 + y : y;
  return year * 100 + mes;
};

const obtenerFuturoMasCercano = async (cultivos = []) => {
  if (!cultivos.length) return [];
  const result = await query(
    `
      SELECT fp.cultivo, fp.posicion, fp.precio_usd, fp.fecha
      FROM futuros_posiciones fp
      JOIN (
        SELECT LOWER(cultivo) AS cultivo_norm, MAX(fecha) AS fecha
        FROM futuros_posiciones
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY LOWER(cultivo)
      ) u
        ON LOWER(fp.cultivo) = u.cultivo_norm
       AND fp.fecha = u.fecha
      WHERE LOWER(fp.cultivo) = ANY($1::text[])
      ORDER BY fp.cultivo, fp.posicion
    `,
    [cultivos.map((c) => normalizarTexto(c))]
  );

  const porCultivo = new Map();
  for (const row of result.rows) {
    const key = normalizarTexto(row.cultivo);
    const list = porCultivo.get(key) || [];
    list.push(row);
    porCultivo.set(key, list);
  }

  const out = [];
  for (const [cultivo, list] of porCultivo.entries()) {
    list.sort((a, b) => parsePosicionMes(a.posicion) - parsePosicionMes(b.posicion));
    out.push({ cultivo, ...list[0] });
  }
  return out;
};

const obtenerTendencia7Dias = async (cultivo) => {
  const result = await query(
    `
      SELECT fecha, AVG(precio)::numeric(12,2) AS precio
      FROM precios
      WHERE LOWER(cultivo) = LOWER($1)
        AND fecha >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY fecha
      ORDER BY fecha ASC
    `,
    [cultivo]
  );
  if (result.rows.length < 2) return null;
  const first = Number(result.rows[0].precio);
  const last = Number(result.rows[result.rows.length - 1].precio);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return Number((((last - first) / first) * 100).toFixed(1));
};

const obtenerTipoCambioDia = async () => {
  const result = await query(
    `
      SELECT DISTINCT ON (tipo) tipo, valor, fecha
      FROM tipo_cambio
      WHERE fecha >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY tipo, fecha DESC
    `
  );
  return result.rows;
};

const obtenerEstadoTipoCambio = async (tipo = "oficial") => {
  const result = await query(
    `
      SELECT tipo, valor, fecha
      FROM tipo_cambio
      WHERE LOWER(tipo) = LOWER($1)
      ORDER BY fecha DESC
      LIMIT 1
    `,
    [tipo]
  );
  return result.rows[0] || null;
};

const obtenerClimaZona = async ({ lat, lng }) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return [];
  const result = await query(
    `
      WITH nearest AS (
        SELECT lat, lng
        FROM clima
        GROUP BY lat, lng
        ORDER BY ABS(lat - $1::numeric) + ABS(lng - $2::numeric)
        LIMIT 1
      )
      SELECT c.fecha, c.temp_min, c.temp_max, c.precipitacion, c.helada, c.descripcion
      FROM clima c
      JOIN nearest n ON c.lat = n.lat AND c.lng = n.lng
      WHERE c.fecha >= CURRENT_DATE
      ORDER BY c.fecha ASC
      LIMIT 3
    `,
    [lat, lng]
  );
  if ((result.rows || []).length) return result.rows;
  try {
    return await obtenerClima(lat, lng);
  } catch (_error) {
    return [];
  }
};

const nombreZona = ({ partido, provincia }) => `${String(partido || "").trim()}, ${String(provincia || "").trim()}`;

const construirBloqueClimaPorZonas = ({ climaPorZona = [] }) => {
  if (!climaPorZona.length) return "Sin datos climáticos para tu zona.";
  return climaPorZona
    .map((item) => {
      const titulo = `📍 ${nombreZona(item.zona)}`;
      const detalle = (item.pronostico || [])
        .map((c) => {
          const dia = formatearFechaCorta(c.fecha);
          const helada = c.helada ? " | ⚠️ Posible helada" : "";
          const pp = Number(c.precipitacion);
          const lluvia = Number.isFinite(pp) ? ` | 🌧️ ${formatearNumero(pp, 1)} mm` : "";
          const desc = String(c.descripcion || "s/d");
          const riesgoTormenta = /torment|granizo/i.test(desc) ? " | ⛈️ Riesgo de tormenta/granizo" : "";
          const riesgoViento = /viento|ventoso/i.test(desc) ? " | 💨 Viento relevante" : "";
          return `${dia}: ${formatearNumero(c.temp_min, 0)}°C - ${formatearNumero(c.temp_max, 0)}°C | ${desc}${lluvia}${helada}${riesgoViento}${riesgoTormenta}`;
        })
        .join("\n");
      return `${titulo}\n${detalle || "Sin datos climáticos para esta zona."}`;
    })
    .join("\n\n");
};

const construirDatoIA = async ({ cultivos, zona, disponible, futuros, tendencias }) => {
  const system = "Sos analista de mercados agropecuarios argentinos. Sé concreto y accionable.";
  const user = [
    `El productor cultiva ${cultivos.join(", ") || "ganaderia"} en ${zona}.`,
    "Analizá los datos de mercado actuales y generá UN SOLO dato concreto, sorprendente y útil que probablemente no sepa.",
    "Máximo 3 líneas. Basate en tendencias reales, contexto internacional o estacionalidad. Nada genérico.",
    "",
    `Disponible: ${JSON.stringify(disponible)}`,
    `Futuros: ${JSON.stringify(futuros)}`,
    `Tendencias 7d: ${JSON.stringify(tendencias)}`,
  ].join("\n");
  try {
    const ia = await generarConPromptLibre({ system, user });
    return String(ia.texto || "").trim();
  } catch (error) {
    console.warn("[PrimerResumen] IA fallback:", error.message);
    return "Dato clave: hoy conviene monitorear base local vs futuro cercano para detectar ventanas de precio.";
  }
};

const obtenerNoticiasRecientes = async ({ maxNoticias = 2, cultivos = [], zonaTxt = "" } = {}) => {
  const max = Math.max(1, Math.min(15, Number(maxNoticias) || 2));
  const keywords = Array.from(
    new Set([
      ...cultivos.map((c) => normalizarTexto(c)).filter(Boolean),
      ...String(zonaTxt)
        .split(",")
        .map((x) => normalizarTexto(x))
        .filter((x) => x && x.length > 2),
    ])
  );

  const result = await query(
    `
      SELECT fuente, titulo, publicado_en
      FROM noticias_agro
      ORDER BY COALESCE(publicado_en, creado_en) DESC
      LIMIT 80
    `
  );
  const rows = result.rows || [];
  const limpiarTitulo = (titulo = "") =>
    String(titulo || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#8211;|&#8212;/g, "-")
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;|&#8221;/g, '"')
      .replace(/&#[0-9]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const esIrrelevante = (titulo = "") => {
    const t = normalizarTexto(titulo);
    return /(dolar blue|dolar mep|dolar bna|cotizacion del euro|euro blue|riesgo pais|bitcoin|cripto)/.test(t);
  };
  const ordenadas = rows
    .map((n) => {
      const limpio = limpiarTitulo(n.titulo);
      const t = normalizarTexto(limpio);
      const related = keywords.some((k) => t.includes(k));
      const scoreMercado = /(precio|rosario|maiz|soja|trigo|girasol|hacienda|granos)/.test(t) ? 1 : 0;
      const penalidad = esIrrelevante(t) ? 1 : 0;
      return { ...n, titulo: limpio, __related: related, __scoreMercado: scoreMercado, __penalidad: penalidad };
    })
    .sort((a, b) => {
      const sa = (a.__related ? 2 : 0) + (a.__scoreMercado ? 1 : 0) - (a.__penalidad ? 2 : 0);
      const sb = (b.__related ? 2 : 0) + (b.__scoreMercado ? 1 : 0) - (b.__penalidad ? 2 : 0);
      if (sa !== sb) return sb - sa;
      const ta = new Date(a.publicado_en || 0).getTime();
      const tb = new Date(b.publicado_en || 0).getTime();
      return tb - ta;
    });

  const elegidas = [];
  const fuentesUsadas = new Set();
  for (const n of ordenadas) {
    if (elegidas.length >= max) break;
    const f = normalizarTexto(n.fuente);
    if (f && !fuentesUsadas.has(f)) {
      elegidas.push(n);
      fuentesUsadas.add(f);
    }
  }
  for (const n of ordenadas) {
    if (elegidas.length >= max) break;
    if (!elegidas.includes(n)) elegidas.push(n);
  }
  // Complemento en vivo para evitar repetir siempre las mismas fuentes/titulares.
  const fuentesWp = [
    { fuente: "Noticias de Campo", url: "https://www.noticiasdecampo.com/wp-json/wp/v2/posts" },
    { fuente: "InfoCampo", url: "https://www.infocampo.com.ar/wp-json/wp/v2/posts" },
    { fuente: "TodoAgro", url: "https://www.todoagro.com.ar/wp-json/wp/v2/posts" },
  ];
  const fallback = [];
  for (const f of fuentesWp) {
    try {
      const r = await axios.get(f.url, {
        timeout: 15000,
        params: { per_page: 2, _fields: "title,link,date", orderby: "date", order: "desc" },
        validateStatus: (s) => s >= 200 && s < 300,
      });
      const items = Array.isArray(r.data) ? r.data : [];
      for (const it of items) {
        const titulo = limpiarTitulo(it?.title?.rendered || "");
        if (!titulo) continue;
        if (esIrrelevante(titulo)) continue;
        fallback.push({
          fuente: f.fuente,
          titulo,
          publicado_en: it?.date || null,
        });
      }
    } catch (_error) {
      // best effort
    }
  }
  const merged = [...elegidas];
  const tituloKey = new Set(merged.map((x) => normalizarTexto(x.titulo)));
  for (const n of fallback) {
    if (merged.length >= max) break;
    const key = normalizarTexto(n.titulo);
    if (tituloKey.has(key)) continue;
    if (fuentesUsadas.has(normalizarTexto(n.fuente))) continue;
    merged.push(n);
    fuentesUsadas.add(normalizarTexto(n.fuente));
    tituloKey.add(key);
  }
  for (const n of fallback) {
    if (merged.length >= max) break;
    const key = normalizarTexto(n.titulo);
    if (tituloKey.has(key)) continue;
    merged.push(n);
    tituloKey.add(key);
  }
  return merged.slice(0, max);
};

const iconoCultivo = (cultivo = "") => {
  const c = normalizarTexto(cultivo);
  if (c.includes("soja")) return "🫘";
  if (c.includes("maiz")) return "🌽";
  if (c.includes("trigo")) return "🌾";
  if (c.includes("girasol")) return "🌻";
  return "🌱";
};

const construirDatoNoGenericoAgricola = ({ cultivos, disponible, futuros, tendencias, tipoCambio }) => {
  if (!cultivos.length) return null;
  const tcMap = new Map(tipoCambio.map((r) => [normalizarTexto(r.tipo), Number(r.valor)]));
  const mep = tcMap.get("mep") || tcMap.get("bolsa") || null;
  const oficial = tcMap.get("oficial") || tcMap.get("bna") || null;

  for (const cultivoRaw of cultivos) {
    const key = normalizarTexto(cultivoRaw);
    const d = disponible.find((x) => normalizarTexto(x.cultivo) === key);
    const f = futuros.find((x) => normalizarTexto(x.cultivo) === key);
    const t = tendencias[key];
    const dispUsd = Number(d?.moneda === "USD" ? d?.precio : NaN);
    const futUsd = Number(f?.precio_usd);
    if (Number.isFinite(dispUsd) && Number.isFinite(futUsd) && dispUsd > 0) {
      const gap = Number((((futUsd - dispUsd) / dispUsd) * 100).toFixed(1));
      const tendenciaTxt =
        typeof t === "number"
          ? `${t >= 0 ? "subiendo" : "corrigiendo"} ${Math.abs(t)}% en 7 días`
          : "sin tendencia clara en 7 días";
      return `${iconoCultivo(cultivoRaw)} En ${cultivoRaw}, el futuro ${f.posicion || "cercano"} está ${gap >= 0 ? "+" : ""}${gap}% vs disponible (${formatearNumero(dispUsd, 0)}→${formatearNumero(futUsd, 0)} USD/tn).\nHoy el mercado viene ${tendenciaTxt}, señal útil para definir timing de venta/cobertura.`;
    }
  }

  for (const cultivoRaw of cultivos) {
    const key = normalizarTexto(cultivoRaw);
    const t = tendencias[key];
    if (typeof t === "number" && Number.isFinite(mep) && Number.isFinite(oficial)) {
      const brecha = Number((((mep - oficial) / oficial) * 100).toFixed(1));
      return `${iconoCultivo(cultivoRaw)} ${cultivoRaw} muestra ${t >= 0 ? "inercia alcista" : "presión bajista"} (${t >= 0 ? "+" : ""}${t}% en 7 días) con brecha cambiaria en ${brecha}%.\nEste combo suele abrir/cerrar ventanas de venta en plazos cortos.`;
    }
  }
  return null;
};

const construirDatoNoGenericoGanadero = ({ mercadosGanaderos = [] }) => {
  const novillo = mercadosGanaderos.find((x) => normalizarTexto(x.categoria).includes("novillo"));
  const ternero = mercadosGanaderos.find((x) => normalizarTexto(x.categoria).includes("ternero"));
  if (!novillo && !ternero) return null;

  const hoyNov = Number(novillo?.precio_promedio);
  const prevNov = Number(novillo?.precio_prev);
  const varNov =
    Number.isFinite(hoyNov) && Number.isFinite(prevNov) && prevNov > 0
      ? Number((((hoyNov - prevNov) / prevNov) * 100).toFixed(1))
      : null;
  const hoyTer = Number(ternero?.precio_promedio);
  const prevTer = Number(ternero?.precio_prev);
  const varTer =
    Number.isFinite(hoyTer) && Number.isFinite(prevTer) && prevTer > 0
      ? Number((((hoyTer - prevTer) / prevTer) * 100).toFixed(1))
      : null;

  if (varNov !== null && varTer !== null) {
    return `💡 Novillo ${varNov >= 0 ? "+" : ""}${varNov}% y ternero ${varTer >= 0 ? "+" : ""}${varTer}% vs la rueda previa.\nCuando ambas categorías se mueven juntas, suele anticipar ajuste de valores en operaciones de la próxima semana.`;
  }
  if (varNov !== null) {
    return `💡 El novillo viene ${varNov >= 0 ? "firme" : "corrigiendo"} (${varNov >= 0 ? "+" : ""}${varNov}% vs la rueda previa).\nEs una señal útil para definir timing de venta en el corto plazo.`;
  }
  return null;
};

const filtrarMercadosGanaderosPorPerfil = ({ mercadosGanaderos = [], perfilGanadero = [] }) => {
  if (!perfilGanadero.length) return mercadosGanaderos;
  const categoriasDecl = perfilGanadero.map((p) => normalizarTexto(p.categoria)).filter(Boolean);
  const especiesDecl = perfilGanadero.map((p) => normalizarTexto(p.especie)).filter(Boolean);
  const matchEspecie = (catNorm) => {
    if (especiesDecl.some((e) => e.includes("porc"))) return /porc|cerd|chancho|lechon/.test(catNorm);
    if (especiesDecl.some((e) => e.includes("ovin"))) return /ovin|oveja|cordero/.test(catNorm);
    if (especiesDecl.some((e) => e.includes("capr"))) return /capr|cabra|chivo/.test(catNorm);
    if (especiesDecl.some((e) => e.includes("camel"))) return /llama|alpaca|camel/.test(catNorm);
    if (especiesDecl.some((e) => e.includes("vacun") || e.includes("bovin"))) return /novillo|ternero|vaca|vaquillona|vacuno|bovino/.test(catNorm);
    return false;
  };
  const filtrados = (mercadosGanaderos || []).filter((m) => {
    const catNorm = normalizarTexto(m.categoria);
    return categoriasDecl.some((c) => catNorm.includes(c) || c.includes(catNorm)) || matchEspecie(catNorm);
  });
  return filtrados.length ? filtrados : [];
};

const KEYWORDS_ESPECIE = {
  vacuno: ["novillo", "ternero", "vaca", "vaquillona", "hacienda", "bovino", "vacuno"],
  porcino: ["porcino", "cerdo", "capon", "capón", "lechon", "lechón"],
  ovino: ["ovino", "oveja", "cordero"],
  caprino: ["caprino", "cabra", "chivo"],
  camelido: ["llama", "alpaca", "camelido"],
};

const extraerPrimerPrecio = (texto = "") => {
  const m = String(texto).match(/\$\s*([\d\.\,]{3,})/);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const obtenerReferenciaGanaderaEnVivo = async ({ perfilGanadero = [] }) => {
  if (!perfilGanadero.length) return null;
  const especies = [...new Set(perfilGanadero.map((p) => normalizarTexto(p.especie)).filter(Boolean))];
  const keywords = [
    ...new Set(
      especies.flatMap((e) => KEYWORDS_ESPECIE[e] || []).concat(["mercado", "precios", "hacienda"])
    ),
  ];
  if (!keywords.length) return null;

  const fuentes = [
    { fuente: "InfoCampo", url: "https://www.infocampo.com.ar/category/mercados-y-empresas/" },
    { fuente: "TodoAgro", url: "https://www.todoagro.com.ar/mercados/" },
  ];

  for (const f of fuentes) {
    try {
      const r = await axios.get(f.url, {
        timeout: 20000,
        headers: { "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)" },
        validateStatus: (s) => s >= 200 && s < 400,
      });
      const html = String(r.data || "");
      const txt = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
      const txtNorm = normalizarTexto(txt);
      const hit = keywords.find((k) => txtNorm.includes(normalizarTexto(k)));
      if (!hit) continue;
      const precio = extraerPrimerPrecio(txt);
      if (precio) {
        return `Referencia en vivo (${f.fuente}): ${hit} alrededor de $${formatearNumero(
          precio,
          0
        )}.`;
      }
      return `Referencia en vivo (${f.fuente}): se detectaron publicaciones recientes vinculadas a ${hit}.`;
    } catch (_error) {
      // best effort
    }
  }
  return null;
};

const construirEjemplos = ({ perfil, cultivos = [] }) => {
  const nombreCultivo = cultivos[0] || "soja";
  if (perfil === "ganaderia") {
    return [
      '→ "¿Cómo viene el novillo esta semana?"',
      '→ "Avisame cuando suba el ternero"',
      '→ "¿Es buen momento para vender hacienda?"',
    ];
  }
  if (perfil === "mixto") {
    return [
      `→ "¿Me conviene vender ${nombreCultivo} esta semana?"`,
      '→ "¿Cómo viene el novillo y el maíz?"',
      '→ "Avisame cuando haya salto en dólar MEP"',
    ];
  }
  return [
    `→ "¿Me conviene vender ${nombreCultivo} esta semana?"`,
    '→ "Avisame cuando el maíz supere USD 200"',
    '→ "¿Cómo viene la cosecha gruesa este año?"',
  ];
};

const construirInsightsPro = ({ cultivos = [], disponible = [], futuros = [], tendencias = {}, clima = [] }) => {
  const lineas = [];
  for (const cultivoRaw of cultivos.slice(0, 2)) {
    const key = normalizarTexto(cultivoRaw);
    const d = disponible.find((x) => normalizarTexto(x.cultivo) === key);
    const f = futuros.find((x) => normalizarTexto(x.cultivo) === key);
    const t = tendencias[key];
    const dispUsd = Number(d?.moneda === "USD" ? d?.precio : NaN);
    const futUsd = Number(f?.precio_usd);
    const spread =
      Number.isFinite(dispUsd) && Number.isFinite(futUsd) && dispUsd > 0
        ? Number((((futUsd - dispUsd) / dispUsd) * 100).toFixed(1))
        : null;
    const tendenciaTxt =
      typeof t === "number" ? `${t >= 0 ? "▲" : "▼"} ${Math.abs(t)}% 7d` : "tendencia s/d";
    if (spread !== null) {
      lineas.push(
        `${iconoCultivo(cultivoRaw)} ${cultivoRaw}: spread futuro/disponible ${spread >= 0 ? "+" : ""}${spread}% (${tendenciaTxt}).`
      );
    } else {
      lineas.push(`${iconoCultivo(cultivoRaw)} ${cultivoRaw}: ${tendenciaTxt}.`);
    }
  }

  const lluvia72h = (clima || [])
    .slice(0, 3)
    .reduce((acc, c) => acc + (Number.isFinite(Number(c.precipitacion)) ? Number(c.precipitacion) : 0), 0);
  const hayHelada = (clima || []).slice(0, 3).some((c) => Boolean(c.helada));
  lineas.push(
    `🌤️ Zona: ${hayHelada ? "riesgo de helada en 72h" : "sin heladas próximas"} y lluvia estimada ${formatearNumero(
      lluvia72h,
      1
    )} mm.`
  );

  lineas.push(
    "🧭 Acción sugerida: definí una venta parcial escalonada si el spread es positivo y mantené alerta climática activa."
  );
  return lineas.join("\n");
};

const construirBloqueOportunidadVenta = ({ cultivos = [], disponible = [], futuros = [], tendencias = {} }) => {
  const oportunidades = [];
  for (const cultivoRaw of cultivos) {
    const key = normalizarTexto(cultivoRaw);
    const d = disponible.find((x) => normalizarTexto(x.cultivo) === key);
    const f = futuros.find((x) => normalizarTexto(x.cultivo) === key);
    const dispUsd = Number(d?.moneda === "USD" ? d?.precio : NaN);
    const futUsd = Number(f?.precio_usd);
    const t = tendencias[key];
    if (!Number.isFinite(dispUsd) || !Number.isFinite(futUsd) || dispUsd <= 0) continue;
    const spread = Number((((futUsd - dispUsd) / dispUsd) * 100).toFixed(1));
    if (spread >= 2 || (typeof t === "number" && t >= 1.5)) {
      oportunidades.push(
        `${iconoCultivo(cultivoRaw)} ${cultivoRaw}: spread ${spread >= 0 ? "+" : ""}${spread}% (${d.mercado || "local"} vs ${f.posicion || "futuro"}). Evaluar fijar 15%-25%.`
      );
    }
  }
  return [
    "🎯 *OPORTUNIDAD DE VENTA (48/72h)*",
    ...(oportunidades.length
      ? oportunidades.slice(0, 2)
      : ["Sin señal fuerte hoy. Mantener alertas de precio para ejecutar rápido."]),
  ].join("\n");
};

const construirBloqueRiesgosOperativos = ({ clima = [] }) => {
  const prox = (clima || []).slice(0, 3);
  const lluvia72h = prox.reduce(
    (acc, c) => acc + (Number.isFinite(Number(c.precipitacion)) ? Number(c.precipitacion) : 0),
    0
  );
  const helada = prox.some((c) => Boolean(c.helada));
  const lluviaAlta = lluvia72h >= 20;
  const semaforo = helada || lluviaAlta ? "🟠" : "🟢";
  const riesgo = [];
  if (helada) riesgo.push("riesgo de helada");
  if (lluviaAlta) riesgo.push(`lluvia acumulada alta (${formatearNumero(lluvia72h, 1)} mm)`);
  return [
    "⚠️ *RIESGOS OPERATIVOS (SEMANA)*",
    `${semaforo} ${riesgo.length ? riesgo.join(" + ") : "sin alertas climáticas relevantes para 72h"}.`,
    "Sugerencia: ajustar labores sensibles y priorizar ventanas de campo seco.",
  ].join("\n");
};

const construirBloquesProExtra = ({ cultivos = [], disponible = [], futuros = [], tipoCambio = [] }) => {
  const tcMap = new Map(tipoCambio.map((r) => [normalizarTexto(r.tipo), Number(r.valor)]));
  const oficial = tcMap.get("oficial");
  const mep = tcMap.get("mep") || tcMap.get("bolsa");
  const brecha =
    Number.isFinite(oficial) && Number.isFinite(mep) && oficial > 0
      ? Number((((mep - oficial) / oficial) * 100).toFixed(1))
      : null;

  let escenario = "Escenarios: datos insuficientes para simulación hoy.";
  const cultivoTop = cultivos[0];
  if (cultivoTop) {
    const key = normalizarTexto(cultivoTop);
    const d = disponible.find((x) => normalizarTexto(x.cultivo) === key);
    const f = futuros.find((x) => normalizarTexto(x.cultivo) === key);
    const dispUsd = Number(d?.moneda === "USD" ? d?.precio : NaN);
    const futUsd = Number(f?.precio_usd);
    if (Number.isFinite(dispUsd) && dispUsd > 0) {
      escenario = `${iconoCultivo(cultivoTop)} ${cultivoTop}: si disponible sube +5%, pasa a USD ${formatearNumero(
        dispUsd * 1.05,
        0
      )}/tn; con -5%, cae a USD ${formatearNumero(dispUsd * 0.95, 0)}/tn.`;
    } else if (Number.isFinite(futUsd) && futUsd > 0) {
      escenario = `${iconoCultivo(cultivoTop)} ${cultivoTop}: si futuro sube +5%, pasa a USD ${formatearNumero(
        futUsd * 1.05,
        0
      )}/tn; con -5%, cae a USD ${formatearNumero(futUsd * 0.95, 0)}/tn.`;
    }
  }

  return [
    [
      "🧪 *ESCENARIOS RÁPIDOS (PRO)*",
      escenario,
      `Brecha cambiaria actual: ${brecha === null ? "s/d" : `${brecha}%`} (MEP vs Oficial).`,
    ].join("\n"),
    [
      "🔔 *ALERTAS SUGERIDAS (PRO)*",
      "1) Avisame si spread futuro/disponible supera +2%.",
      "2) Avisame si hay helada en próximos 3 días.",
      "3) Avisame si MEP se mueve más de 2% diario.",
    ].join("\n"),
  ];
};

const hayDatosBaseResumen = ({ disponible = [], tipoCambio = [], clima = [], mercadosGanaderos = [] }) => {
  const hayDisponible = (disponible || []).some((x) => Number.isFinite(Number(x?.precio)));
  const hayTc = (tipoCambio || []).some((x) => Number.isFinite(Number(x?.valor)));
  const hayClima = (clima || []).length > 0;
  const hayGanado = (mercadosGanaderos || []).some((x) => Number.isFinite(Number(x?.precio_promedio)));
  return hayDisponible || hayTc || hayClima || hayGanado;
};

const hayDatosMinimosParaPrimerResumen = async () => {
  const checks = await Promise.all([
    query(
      `
        SELECT COUNT(*)::int AS total
        FROM precios
        WHERE fecha >= CURRENT_DATE - INTERVAL '10 days'
      `
    ),
    query(
      `
        SELECT COUNT(*)::int AS total
        FROM tipo_cambio
        WHERE fecha >= CURRENT_DATE - INTERVAL '5 days'
      `
    ),
    query(
      `
        SELECT COUNT(*)::int AS total
        FROM clima
        WHERE fecha >= CURRENT_DATE - INTERVAL '5 days'
      `
    ),
  ]);
  const precios = Number(checks[0].rows[0]?.total || 0);
  const tc = Number(checks[1].rows[0]?.total || 0);
  const clima = Number(checks[2].rows[0]?.total || 0);
  return precios > 0 && tc > 0 && clima > 0;
};

const obtenerMercadosGanaderos = async () => {
  const result = await query(
    `
      WITH base AS (
        SELECT
          categoria,
          precio_promedio,
          fecha,
          LAG(precio_promedio) OVER (PARTITION BY categoria ORDER BY fecha) AS precio_prev
        FROM precios_hacienda
      ),
      ult AS (
        SELECT b.*
        FROM base b
        JOIN (
          SELECT categoria, MAX(fecha) AS fecha
          FROM precios_hacienda
          GROUP BY categoria
        ) u
          ON u.categoria = b.categoria
         AND u.fecha = b.fecha
      )
      SELECT categoria, precio_promedio, precio_prev, fecha
      FROM ult
      ORDER BY
        CASE
          WHEN LOWER(categoria) LIKE '%novillo%' THEN 0
          WHEN LOWER(categoria) LIKE '%ternero%' THEN 1
          WHEN LOWER(categoria) LIKE '%vaca%' THEN 2
          ELSE 3
        END,
        categoria
      LIMIT 6
    `
  );
  return result.rows;
};

const obtenerUltimaFechaHacienda = async () => {
  const result = await query(
    `
      SELECT MAX(fecha) AS fecha
      FROM precios_hacienda
    `
  );
  return result.rows[0]?.fecha || null;
};

const ensureResumenesTipoSchema = async () => {
  await query("ALTER TABLE resumenes ADD COLUMN IF NOT EXISTS tipo VARCHAR(30) DEFAULT 'diario'");
  await query(`
    DO $$
    DECLARE r RECORD;
    BEGIN
      FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
        WHERE nsp.nspname = 'public'
          AND rel.relname = 'resumenes'
          AND con.contype = 'u'
          AND con.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'usuario_id' AND NOT attisdropped),
            (SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'fecha' AND NOT attisdropped)
          ]::smallint[]
      LOOP
        EXECUTE format('ALTER TABLE resumenes DROP CONSTRAINT IF EXISTS %I', r.conname);
      END LOOP;
    END $$;
  `);
  await query(
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_resumenes_usuario_fecha_tipo ON resumenes (usuario_id, fecha, tipo)"
  );
};

const guardarResumenBienvenida = async ({ usuarioId, contenido, tokensUsados = null }) => {
  await ensureResumenesTipoSchema();
  const result = await query(
    `
      INSERT INTO resumenes (usuario_id, fecha, tipo, contenido, tokens_usados, enviado_wp, enviado_en)
      VALUES ($1, CURRENT_DATE, 'bienvenida', $2, $3, true, NOW())
      ON CONFLICT (usuario_id, fecha, tipo)
      DO UPDATE SET
        contenido = EXCLUDED.contenido,
        tokens_usados = EXCLUDED.tokens_usados,
        enviado_wp = true,
        enviado_en = NOW(),
        creado_en = NOW()
      RETURNING id
    `,
    [usuarioId, contenido, tokensUsados]
  );
  return result.rows[0]?.id || null;
};

const generarPrimerResumen = async (usuario, opts = {}) => {
  const { sendMessage } = require("../config/whatsapp");
  const base = await obtenerPerfilCompleto(usuario?.id);
  if (!base) {
    throw new Error("No se pudo construir primer resumen: usuario inexistente");
  }
  const perfil = await asegurarGeoUsuario(base);
  const datosListosInicial = await hayDatosMinimosParaPrimerResumen();
  if (!datosListosInicial) {
    try {
      console.warn("[PrimerResumen] Faltan datos mínimos, disparando recolector previo...");
      await ejecutarRecolectorDiario();
    } catch (error) {
      console.error("[PrimerResumen] Recolector previo falló:", error.message);
    }
  }
  const planEfectivo = resolverPlanEfectivo({
    plan: perfil.plan,
    planActivoHasta: perfil.plan_activo_hasta,
  });
  const esBasico = planEfectivo === "basico";
  const esPro = planEfectivo === "pro";
  const maxZonas = limiteZonasPorPlan(planEfectivo);
  const noticiasPorPlan = planEfectivo === "pro"
    ? Math.max(1, Math.min(15, Number(perfil.noticias_cantidad_pref) || 8))
    : planEfectivo === "basico"
    ? 5
    : 2;
  const tieneBloquesPlus = esBasico || esPro;
  const cultivosCrudos = perfil.cultivos || [];
  const cultivos = Array.from(
    new Set(cultivosCrudos.map((c) => normalizarCultivo(c)).filter(Boolean))
  );
  const mencionaGanaderia =
    perfil.perfil_productivo === "ganaderia" ||
    perfil.perfil_productivo === "mixto" ||
    cultivosCrudos.some((c) => {
      const t = normalizarTexto(c);
      return t.includes("ganader") || t.includes("hacienda");
    });
  const zonasUsuario = await obtenerZonasUsuario({
    usuarioId: perfil.id,
    perfil,
    limite: maxZonas,
  });
  const zona = zonasUsuario.length
    ? zonasUsuario.map((z) => nombreZona(z)).join(" | ")
    : `${perfil.partido || "tu zona"}, ${perfil.provincia || "Argentina"}`;

  const [disponibleRaw, futuros, tipoCambio, mercadosGanaderos, noticias, estadoCultivos, tcOficial, fechaHacienda, perfilGanadero] = await Promise.all([
    obtenerDisponiblePorCultivo(cultivos),
    obtenerFuturoMasCercano(cultivos),
    obtenerTipoCambioDia(),
    obtenerMercadosGanaderos(),
    obtenerNoticiasRecientes({ maxNoticias: noticiasPorPlan, cultivos, zonaTxt: zona }),
    obtenerEstadoDisponibilidadCultivos(cultivos),
    obtenerEstadoTipoCambio("oficial"),
    obtenerUltimaFechaHacienda(),
    obtenerPerfilGanaderoUsuario(perfil.id),
  ]);
  const mercadosGanaderosPerfil = filtrarMercadosGanaderosPorPerfil({
    mercadosGanaderos,
    perfilGanadero,
  });
  const disponible = await completarDisponibleConWebFallback({
    cultivos,
    disponible: disponibleRaw,
  });
  const climaPorZona = [];
  for (const z of zonasUsuario) {
    const pron = await obtenerClimaZona({ lat: z.lat, lng: z.lng });
    if (pron.length) climaPorZona.push({ zona: z, pronostico: pron });
  }
  const clima = climaPorZona[0]?.pronostico || [];

  const tendenciasMap = {};
  for (const cultivo of cultivos) {
    tendenciasMap[normalizarTexto(cultivo)] = await obtenerTendencia7Dias(cultivo);
  }

  const lineasCultivos = cultivos.map((cultivoRaw) => {
    const cultivo = normalizarTexto(cultivoRaw);
    const d = disponible.find((x) => normalizarTexto(x.cultivo) === cultivo);
    const f = futuros.find((x) => normalizarTexto(x.cultivo) === cultivo);
    const t = tendenciasMap[cultivo];
    const trendTxt =
      typeof t === "number" ? `${t >= 0 ? "▲" : "▼"} ${Math.abs(t)}%` : "sin datos";
    const estado = estadoCultivos.get(cultivo);
    const disponibleLabel = d?.mercado ? d.mercado : "local";
    const disponiblePrecio = d
      ? `${d.moneda} ${formatearNumero(d.precio, 0)}/tn`
      : estado?.ultimaFecha
      ? `s/d (sin publicación hoy. Último: ${formatearFechaCortaNumerica(
          estado.ultimaFecha
        )} en ${estado.ultimoMercado || "mercado"}: ${estado.ultimaMoneda || ""} ${formatearNumero(
          estado.ultimoPrecio,
          0
        )})`
      : "s/d (sin histórico de precios cargado)";
    const futuroLabel = f?.posicion || "cercano";
    const futuroPrecio = Number.isFinite(Number(f?.precio_usd))
      ? `USD ${formatearNumero(f.precio_usd, 0)}/tn`
      : "s/d";
    return [
      `${iconoCultivo(cultivoRaw)} *${etiquetaCultivo(cultivoRaw)}*`,
      `Disponible ${disponibleLabel}: ${disponiblePrecio}`,
      `Futuro ${futuroLabel}: ${futuroPrecio}`,
      `Tendencia 7 días: ${trendTxt}`,
      "",
    ].join("\n");
  });

  const lineasGanaderiaBase = (mercadosGanaderosPerfil || []).map((m) => {
    const hoy = Number(m.precio_promedio);
    const prev = Number(m.precio_prev);
    const deltaPct =
      Number.isFinite(hoy) && Number.isFinite(prev) && prev > 0
        ? Number((((hoy - prev) / prev) * 100).toFixed(1))
        : null;
    const flecha = deltaPct === null ? "→" : deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "→";
    const deltaTxt = deltaPct === null ? "" : ` ${deltaPct > 0 ? "+" : ""}${deltaPct}%`;
    return `${m.categoria}:  $${formatearNumero(hoy, 0)}/kg ${flecha}${deltaTxt}`;
  });
  const referenciaVivoGanaderia = await obtenerReferenciaGanaderaEnVivo({ perfilGanadero });
  const lineasGanaderia =
    lineasGanaderiaBase.length > 0
      ? lineasGanaderiaBase
      : (perfilGanadero || []).length
      ? [
          `Sin cotización específica para: ${(perfilGanadero || []).map((p) => p.categoria).join(", ")}.`,
          referenciaVivoGanaderia || "",
          "Referencia disponible hoy (mercado general):",
          ...((mercadosGanaderos || []).slice(0, 1).map((m) => `${m.categoria}:  $${formatearNumero(m.precio_promedio, 0)}/kg`) || [
            "Sin referencia ganadera cargada hoy.",
          ]),
        ]
      : [];

  const tcMap = new Map(tipoCambio.map((r) => [normalizarTexto(r.tipo), Number(r.valor)]));
  const oficialActual = tcMap.get("oficial") || tcMap.get("bna");
  const tcLinea = [
    `Oficial: $${formatearNumero(oficialActual, 0)}${
      Number.isFinite(Number(oficialActual))
        ? ""
        : tcOficial?.fecha
        ? ` (sin dato hoy. Último ${formatearFechaCortaNumerica(tcOficial.fecha)}: $${formatearNumero(
            tcOficial.valor,
            0
          )})`
        : " (sin histórico)"
    }`,
    `Blue: $${formatearNumero(tcMap.get("blue"), 0)}`,
    `MEP: $${formatearNumero(tcMap.get("mep") || tcMap.get("bolsa"), 0)}`,
  ].join(" | ");

  const climaTxt = construirBloqueClimaPorZonas({ climaPorZona });

  const hayDatosBase = hayDatosBaseResumen({
    disponible,
    tipoCambio,
    clima,
    mercadosGanaderos,
  });
  const datoIA = hayDatosBase
    ? await construirDatoIA({
        cultivos,
        zona,
        disponible,
        futuros,
        tendencias: tendenciasMap,
      })
    : "Todavía no tengo datos de mercado suficientes para darte un insight confiable. En la próxima actualización te envío una recomendación concreta con números reales.";
  const datoHardAgricola = construirDatoNoGenericoAgricola({
    cultivos,
    disponible,
    futuros,
    tendencias: tendenciasMap,
    tipoCambio,
  });
  const datoHardGanadero = construirDatoNoGenericoGanadero({
    mercadosGanaderos: mercadosGanaderosPerfil.length ? mercadosGanaderosPerfil : mercadosGanaderos,
  });
  const titulares = noticias.slice(0, noticiasPorPlan).map((n) => `- ${n.titulo} (${n.fuente})`).join("\n");
  const datoBase =
    perfil.perfil_productivo === "ganaderia"
      ? datoHardGanadero || datoIA
      : datoHardAgricola || datoIA;
  const datoFinal = [datoBase, "", "Hoy además se destaca en noticias:", titulares || "- Sin titulares recientes (reintentando en próxima actualización)."]
    .join("\n")
    .trim();

  const ejemplos = construirEjemplos({
    perfil: perfil.perfil_productivo,
    cultivos,
  });
  const insightsPro = esPro
    ? construirInsightsPro({
        cultivos,
        disponible,
        futuros,
        tendencias: tendenciasMap,
        clima,
      })
    : "";
  const bloqueOportunidad = tieneBloquesPlus
    ? construirBloqueOportunidadVenta({
        cultivos,
        disponible,
        futuros,
        tendencias: tendenciasMap,
      })
    : "";
  const bloqueRiesgos = tieneBloquesPlus ? construirBloqueRiesgosOperativos({ clima }) : "";
  const bloquesProExtra = esPro
    ? construirBloquesProExtra({
        cultivos,
        disponible,
        futuros,
        tipoCambio,
      })
    : [];

  const encabezado =
    perfil.perfil_productivo === "ganaderia"
      ? `🐄 *¡Bienvenido a AgroHabilis, ${perfil.nombre}!*`
      : `🌾 *¡Bienvenido a AgroHabilis, ${perfil.nombre}!*`;

  const texto = [
    encabezado,
    "Este es tu primer resumen personalizado.",
    "",
    ...(cultivos.length
      ? [
          "━━━━━━━━━━━━━━━━━━━━━━━",
          "💰 *TUS CULTIVOS HOY*",
          "━━━━━━━━━━━━━━━━━━━━━━━",
          lineasCultivos.join("\n") || "Sin datos de cultivos.",
        ]
      : []),
    ...(mencionaGanaderia
      ? [
          "━━━━━━━━━━━━━━━━━━━━━━━",
          "🐄 *TU HACIENDA HOY*",
          "━━━━━━━━━━━━━━━━━━━━━━━",
          lineasGanaderia.join("\n") ||
            (fechaHacienda
              ? `Sin datos de hacienda publicados hoy. Última actualización: ${formatearFechaCortaNumerica(
                  fechaHacienda
                )}.`
              : "Sin datos de hacienda (sin histórico cargado)."),
        ]
      : []),
    "━━━━━━━━━━━━━━━━━━━━━━━",
    "💵 *TIPO DE CAMBIO*",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    tcLinea,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    "🌤️ *CLIMA EN TUS ZONAS*",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    climaTxt || "Sin datos climáticos para tus zonas.",
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    perfil.perfil_productivo === "ganaderia"
      ? "💡 *DATO CLAVE*"
      : "🔍 *DATO QUE QUIZÁS NO SABÍAS*",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    datoFinal,
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    "💡 *PODÉS PREGUNTARME AHORA*",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    ...ejemplos,
    ...(tieneBloquesPlus
      ? [
          "",
          "━━━━━━━━━━━━━━━━━━━━━━━",
          bloqueOportunidad,
          "━━━━━━━━━━━━━━━━━━━━━━━",
          bloqueRiesgos,
        ]
      : []),
    ...(esPro
      ? [
          "",
          "━━━━━━━━━━━━━━━━━━━━━━━",
          "🧠 *INSIGHTS PRO (PRODUCTO + ZONA)*",
          "━━━━━━━━━━━━━━━━━━━━━━━",
          insightsPro,
          "",
          "━━━━━━━━━━━━━━━━━━━━━━━",
          bloquesProExtra[0],
          "━━━━━━━━━━━━━━━━━━━━━━━",
          bloquesProExtra[1],
        ]
      : []),
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━",
    `📦 *PLAN ACTUAL: ${String(planEfectivo).toUpperCase()}*`,
    "━━━━━━━━━━━━━━━━━━━━━━━",
    "Si querés cambiarlo, escribí:",
    "- QUIERO PLAN BASICO ($9.000/mes)",
    "- QUIERO PLAN PRO ($18.000/mes)",
    "- QUIERO PLAN GRATIS ($0/mes)",
    "",
    "📆 En Plan Gratis recibís resumen 2 veces por semana:",
    "- al día siguiente de tu registro",
    "- luego todos los lunes y jueves (8am)",
    "",
    "Y cuando quieras mejorar tus recomendaciones escribí:",
    "COMPLETAR PERFIL",
    "",
    "Si querés recomendaciones más procesadas (ej: margen por cultivo), te voy a pedir datos como hectáreas y costo por ha.",
    "Para ver todos los comandos, escribí:",
    "VER COMANDOS",
  ].join("\n");

  const enviar = opts.enviar !== false;
  const destinoEnvio = perfil.whatsapp_jid || perfil.whatsapp_real || perfil.whatsapp;
  let response = null;
  let resumenId = null;
  if (enviar) {
    response = await sendMessage(destinoEnvio, texto);
    resumenId = await guardarResumenBienvenida({
      usuarioId: perfil.id,
      contenido: texto,
    });
  }

  return {
    ok: true,
    resumenId,
    whatsappMessageId: response?.id?._serialized || null,
    destinoEnvio,
    texto,
  };
};

module.exports = {
  generarPrimerResumen,
};
