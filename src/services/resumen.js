const axios = require("axios");
const { query } = require("../config/database");
const { generarConPromptLibre } = require("./gemini");
const { actualizarUsuario, obtenerPerfil, normalizarWhatsapp } = require("../models/usuario");
const { obtenerResumenFinanciero } = require("./gastos");
const { calcularCostoPorHa } = require("./calculadora_costos");
const { resolverPlanEfectivo } = require("./planes");
const {
  obtenerTipoCambioDia,
  persistirTiposCambioDesdeScraper,
} = require("./tipo_cambio");
const { obtenerTipoCambio } = require("../scrapers/dolar");
const { obtenerClima } = require("../scrapers/clima");
const { obtenerMercadosWeb } = require("../scrapers/mercados_web");

const toISODate = (d) => new Date(d).toISOString().slice(0, 10);
const normalizar = (txt = "") =>
  String(txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const limpiarTitulo = (txt = "") =>
  String(txt || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#[0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const limpiarTextoPlano = (txt = "", max = 340) =>
  String(txt || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

let _tieneFuentePreciosResumen = null;
const tieneFuentePreciosResumen = async () => {
  if (_tieneFuentePreciosResumen !== null) return _tieneFuentePreciosResumen;
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
  _tieneFuentePreciosResumen = Boolean(r.rows[0]);
  return _tieneFuentePreciosResumen;
};

const geocodificarZona = async ({ partido, provincia }) => {
  if (!partido || !provincia) return null;
  const response = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: {
      q: `${partido}, ${provincia}, Argentina`,
      format: "json",
      limit: 1,
    },
    timeout: 30_000,
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

const asegurarGeolocalizacion = async (perfil) => {
  if (!perfil) return null;
  if (perfil.lat !== null && perfil.lng !== null) return perfil;

  try {
    const geo = await geocodificarZona({
      partido: perfil.partido,
      provincia: perfil.provincia,
    });
    if (!geo) return perfil;
    const actualizado = await actualizarUsuario(perfil.id, geo);
    return { ...perfil, lat: actualizado?.lat ?? geo.lat, lng: actualizado?.lng ?? geo.lng };
  } catch (error) {
    console.warn("[Resumen] No se pudo geocodificar zona:", error.message);
    return perfil;
  }
};

const obtenerPreciosCultivosUsuario = async (cultivos = []) => {
  if (!cultivos.length) return { fecha: null, items: [], variaciones: {} };

  const fechaRows = await query(
    `
      SELECT DISTINCT fecha
      FROM precios
      ORDER BY fecha DESC
      LIMIT 2
    `
  );
  const fechas = fechaRows.rows.map((r) => r.fecha).filter(Boolean);
  if (!fechas.length) return { fecha: null, items: [], variaciones: {} };

  const cultivosNorm = cultivos.map((c) => normalizar(c));
  const preciosRows = await query(
    `
      SELECT cultivo, moneda, fecha, AVG(precio)::numeric(12,2) AS precio_promedio
      FROM precios
      WHERE fecha = ANY($1::date[])
        AND LOWER(cultivo) = ANY($2::text[])
      GROUP BY cultivo, moneda, fecha
      ORDER BY cultivo, moneda, fecha DESC
    `,
    [fechas, cultivosNorm]
  );

  const latest = fechas[0];
  const prev = fechas[1] || null;
  const byCultivo = {};

  for (const row of preciosRows.rows) {
    const cultivo = row.cultivo;
    const moneda = row.moneda;
    if (!byCultivo[cultivo]) byCultivo[cultivo] = { cultivo };
    if (toISODate(row.fecha) === toISODate(latest)) {
      if (moneda === "ARS") byCultivo[cultivo].precio_ars = Number(row.precio_promedio);
      if (moneda === "USD") byCultivo[cultivo].precio_usd = Number(row.precio_promedio);
    }
    if (prev && toISODate(row.fecha) === toISODate(prev) && moneda === "ARS") {
      byCultivo[cultivo].precio_ars_ayer = Number(row.precio_promedio);
    }
  }

  const items = Object.values(byCultivo).map((item) => {
    const hoy = Number(item.precio_ars);
    const ayer = Number(item.precio_ars_ayer);
    const variacion =
      Number.isFinite(hoy) && Number.isFinite(ayer) ? Number((hoy - ayer).toFixed(2)) : null;
    const tieneDatoPrevio = Number.isFinite(ayer);
    const variacionTexto = tieneDatoPrevio
      ? variacion > 0
        ? `▲ ${variacion}`
        : variacion < 0
        ? `▼ ${Math.abs(variacion)}`
        : "▲ 0"
      : "▲ sin dato prev.";
    return {
      ...item,
      variacion_ars: variacion,
      tiene_dato_previo: tieneDatoPrevio,
      variacion_texto: variacionTexto,
    };
  });

  const variaciones = {};
  for (const item of items) variaciones[item.cultivo] = item.variacion_ars;

  // Fallback web por cultivo faltante (ej: maiz) para no quedar en s/d.
  const setPresentes = new Set(items.map((i) => normalizar(i.cultivo)));
  const faltantes = cultivos.filter((c) => !setPresentes.has(normalizar(c)));
  if (faltantes.length) {
    const faltantesNorm = faltantes.map((c) => normalizar(c));
    if (faltantesNorm.includes("papa")) {
      try {
        const papaR = await query(
          `
            SELECT fecha, precio_ars, precio_usd
            FROM precios_horticolas
            WHERE producto = 'papa'
            ORDER BY fecha DESC, creado_en DESC
            LIMIT 2
          `
        );
        if (papaR.rows[0]) {
          const hoy = papaR.rows[0];
          const ayer = papaR.rows[1] || null;
          const hoyArs = Number(hoy.precio_ars);
          const ayerArs = Number(ayer?.precio_ars);
          const variacionArs =
            Number.isFinite(hoyArs) && Number.isFinite(ayerArs) ? Number((hoyArs - ayerArs).toFixed(2)) : null;
          items.push({
            cultivo: "Papa",
            precio_ars: Number.isFinite(hoyArs) ? hoyArs : null,
            precio_usd: Number.isFinite(Number(hoy.precio_usd)) ? Number(hoy.precio_usd) : null,
            precio_ars_ayer: Number.isFinite(ayerArs) ? ayerArs : null,
            variacion_ars: variacionArs,
            tiene_dato_previo: Number.isFinite(ayerArs),
            variacion_texto: Number.isFinite(variacionArs)
              ? variacionArs > 0
                ? `▲ ${variacionArs}`
                : variacionArs < 0
                ? `▼ ${Math.abs(variacionArs)}`
                : "▲ 0"
              : "▲ sin dato prev.",
          });
        }
      } catch (_error) {
        // best effort horticola
      }
    }
  }

  const setPresentesPostHorti = new Set(items.map((i) => normalizar(i.cultivo)));
  const faltantesPostHorti = cultivos.filter((c) => !setPresentesPostHorti.has(normalizar(c)));
  if (faltantesPostHorti.length) {
    try {
      const web = await obtenerMercadosWeb();
      for (const cultivo of faltantesPostHorti) {
        const hit = (web.items || []).find((x) => normalizar(x.cultivo) === normalizar(cultivo));
        if (!hit) continue;
        items.push({
          cultivo,
          precio_ars: Number.isFinite(Number(hit.precio_ars)) ? Number(hit.precio_ars) : null,
          precio_usd: Number.isFinite(Number(hit.precio_usd)) ? Number(hit.precio_usd) : null,
          precio_ars_ayer: null,
          variacion_ars: null,
          tiene_dato_previo: false,
          variacion_texto: "▲ sin dato prev.",
        });
      }
    } catch (_error) {
      // best effort
    }
  }

  return { fecha: latest, items, variaciones };
};

const obtenerFuturosPosicionesUsuario = async (cultivos = []) => {
  if (!cultivos.length) return [];
  const cultivosNorm = cultivos.map((c) => normalizar(c));
  const result = await query(
    `
      SELECT fp.cultivo, fp.posicion, fp.precio_usd, fp.variacion, fp.volumen, fp.fecha
      FROM futuros_posiciones fp
      JOIN (
        SELECT cultivo, MAX(fecha) AS fecha
        FROM futuros_posiciones
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY cultivo
      ) ult
        ON LOWER(fp.cultivo) = LOWER(ult.cultivo) AND fp.fecha = ult.fecha
      WHERE LOWER(fp.cultivo) = ANY($1::text[])
      ORDER BY fp.cultivo, fp.posicion
    `,
    [cultivosNorm]
  );
  return result.rows;
};

const obtenerClimaZona = async ({ lat, lng }) => {
  if (lat === null || lng === null || lat === undefined || lng === undefined) {
    return [];
  }
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
      LIMIT 7
    `,
    [lat, lng]
  );
  const rows = result.rows || [];
  if (rows.length) return rows;
  try {
    return await obtenerClima(lat, lng);
  } catch (_error) {
    return [];
  }
};

const calcularMetricaCultivos = (cultivos, preciosHoy) => {
  const precioByCultivo = new Map(
    preciosHoy.map((p) => [normalizar(p.cultivo), p])
  );

  return cultivos.map((c) => {
    const key = normalizar(c.cultivo);
    const precio = precioByCultivo.get(key);
    const precioArs = Number(precio?.precio_ars);
    const costo = Number(c.costo_por_ha);
    const margen =
      Number.isFinite(precioArs) && Number.isFinite(costo)
        ? Number((precioArs - costo).toFixed(2))
        : null;
    return {
      cultivo: c.cultivo,
      hectareas: c.hectareas,
      costo_por_ha: c.costo_por_ha,
      precio_ars: Number.isFinite(precioArs) ? precioArs : null,
      precio_usd: Number.isFinite(Number(precio?.precio_usd))
        ? Number(precio.precio_usd)
        : null,
      variacion_ars: Number.isFinite(Number(precio?.variacion_ars))
        ? Number(precio.variacion_ars)
        : null,
      margen_estimado: margen,
    };
  });
};

const clasificarFuentePrecioResumen = (row = {}) => {
  const blob = normalizar(`${row.fuente || ""} ${row.mercado || ""} ${row.tipo_precio || ""}`);
  if (/\bfob\b|magyp|cac|camara|c[aá]mara|arbitral|oficial/.test(blob)) return "institucional_oficial";
  if (/maroun|corredor|acopio|siogranos|bcr|mercado\s*fisico|disponible|operacion_real|oferta/.test(blob))
    return "operativo_comercial";
  return "operativo_comercial";
};

const obtenerDetallePreciosPorFuentes = async (cultivos = []) => {
  if (!cultivos.length) return [];
  const cultivosNorm = cultivos.map((c) => normalizar(c)).filter(Boolean);
  if (!cultivosNorm.length) return [];
  const usarFuente = await tieneFuentePreciosResumen();
  const selFuente = usarFuente ? "fuente" : "NULL::text AS fuente";
  const r = await query(
    `
      WITH ult AS (
        SELECT LOWER(cultivo) AS cultivo_norm, MAX(fecha) AS fecha
        FROM precios
        WHERE LOWER(cultivo) = ANY($1::text[])
        GROUP BY LOWER(cultivo)
      )
      SELECT p.cultivo, p.mercado, p.precio, p.moneda, p.fecha, p.tipo_precio, ${selFuente}
      FROM precios p
      JOIN ult u
        ON LOWER(p.cultivo) = u.cultivo_norm
       AND p.fecha = u.fecha
      WHERE LOWER(p.cultivo) = ANY($1::text[])
      ORDER BY p.cultivo, p.precio DESC NULLS LAST
      LIMIT 120
    `,
    [cultivosNorm]
  );
  return r.rows || [];
};

const construirBloquePreciosDetallado = ({ metricas = [], detalleFuentes = [] }) => {
  const out = ["💰 *PRECIOS DEL DÍA*"];
  const detalleByCultivo = new Map();
  for (const d of detalleFuentes) {
    const k = normalizar(d.cultivo);
    if (!detalleByCultivo.has(k)) detalleByCultivo.set(k, []);
    detalleByCultivo.get(k).push(d);
  }
  for (const m of metricas || []) {
    const k = normalizar(m.cultivo);
    const detalles = detalleByCultivo.get(k) || [];
    const varTxt =
      typeof m.variacion_ars === "number"
        ? m.variacion_ars > 0
          ? `▲ ${m.variacion_ars}`
          : m.variacion_ars < 0
          ? `▼ ${Math.abs(m.variacion_ars)}`
          : "▲ 0"
        : "▲ sin dato prev.";
    out.push(
      `- ${m.cultivo}: ${formatearMoneda(m.precio_ars, "ARS")} | ${formatearMoneda(m.precio_usd, "USD")} (${varTxt})`
    );
    const oper = detalles.filter((x) => clasificarFuentePrecioResumen(x) === "operativo_comercial").slice(0, 2);
    const inst = detalles.filter((x) => clasificarFuentePrecioResumen(x) === "institucional_oficial").slice(0, 2);
    if (oper.length) {
      const txt = oper
        .map((x) => `${x.fuente || x.mercado || "operativa"} ${formatearMoneda(x.precio, x.moneda || "ARS")}`)
        .join(" | ");
      out.push(`  · Operativo/comercial: ${txt}`);
    }
    if (inst.length) {
      const txt = inst
        .map((x) => `${x.fuente || x.mercado || "oficial"} ${formatearMoneda(x.precio, x.moneda || "ARS")}`)
        .join(" | ");
      out.push(`  · Institucional/oficial: ${txt}`);
    }
  }
  if ((metricas || []).length === 0) out.push("- Sin datos de precios para tus cultivos.");
  return out.join("\n");
};

const inyectarBloquePrecios = (texto = "", bloque = "") => {
  if (!bloque) return texto;
  const re = /💰 \*PRECIOS DEL D[IÍ]A\*[\s\S]*?(?=\n\n💵 \*TIPO DE CAMBIO\*)/;
  if (re.test(texto)) return texto.replace(re, bloque);
  return texto;
};

const guardarResumen = async ({ usuarioId, texto, tokensUsados }) => {
  const result = await query(
    `
      INSERT INTO resumenes (usuario_id, fecha, tipo, contenido, tokens_usados, enviado_wp)
      VALUES ($1, CURRENT_DATE, 'diario', $2, $3, false)
      ON CONFLICT (usuario_id, fecha, tipo)
      DO UPDATE SET
        contenido = EXCLUDED.contenido,
        tokens_usados = EXCLUDED.tokens_usados,
        enviado_wp = false,
        enviado_en = NULL,
        creado_en = NOW()
      RETURNING id, usuario_id, fecha, contenido, tokens_usados, enviado_wp, enviado_en
    `,
    [usuarioId, texto, tokensUsados]
  );
  return result.rows[0];
};

const marcarResumenEnviado = async (resumenId) => {
  await query(
    `
      UPDATE resumenes
      SET enviado_wp = true, enviado_en = NOW()
      WHERE id = $1
    `,
    [resumenId]
  );
};

const obtenerPerfilPorId = async (usuarioId) => {
  const usuarioResult = await query(
    `
      SELECT id, nombre, whatsapp, provincia, partido, lat, lng, plan, plan_activo_hasta, activo, tipo_comercializacion, noticias_cantidad_pref
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const usuario = usuarioResult.rows[0];
  if (!usuario) return null;

  const cultivosResult = await query(
    `
      SELECT cultivo, hectareas, costo_por_ha
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
    cultivos: cultivosResult.rows,
    perfil_productivo: perfilResult.rows[0]?.tipo || "agricultura",
  };
};

const armarPromptResumen = ({
  perfil,
  fecha,
  cultivos,
  precios,
  tipoCambio,
  clima,
  sinSaludoInicial = false,
}) => {
  const cultivosTexto = cultivos.map((c) => c.cultivo).join(", ") || "sin cultivos cargados";
  const hectareasTotales = cultivos.reduce((acc, c) => acc + (Number(c.hectareas) || 0), 0);
  const perfilTipo = String(perfil.perfil_productivo || "agricultura").toLowerCase();
  const esGanaderoSinCultivos = perfilTipo === "ganaderia" && !cultivos.length;

  const cabeceraFormato = sinSaludoInicial
    ? `📅 *Resumen AgroHabilis* - ${fecha}
(NO incluyas saludo tipo "buenos días" ni el nombre al inicio; el usuario ya está en conversación activa.)`
    : `🌾 *Buenos días, ${perfil.nombre}!*
📅 Resumen AgroHabilis - ${fecha}`;

  const system = `Generá un resumen diario agropecuario para ${perfil.nombre}, 
productor de ${perfil.provincia}, partido de ${perfil.partido}.
Trabajás con ${cultivosTexto} en ${hectareasTotales || "N/D"} hectáreas.

El resumen debe tener este formato exacto:

${cabeceraFormato}

💰 *PRECIOS DEL DÍA*
(listar cada cultivo con precio ARS y USD. Si hay dato de ayer, mostrar variación con ▲ o ▼. Si no hay dato previo, mostrar "▲ sin dato prev.")

💵 *TIPO DE CAMBIO*
(oficial, blue, MEP)

🌤️ *CLIMA EN ${perfil.partido || "tu zona"}*
(próximos 3 días, alertas de helada si corresponde)

📊 *TU SITUACIÓN*
(análisis breve y concreto basado en sus cultivos y costos)

💡 *CONSEJO DEL DÍA*
(una sola recomendación accionable y concreta)

Usá lenguaje simple y directo. Máximo 300 palabras.
${esGanaderoSinCultivos ? "\nIMPORTANTE: este usuario no tiene cultivos cargados. NO inventes ni menciones cultivos o precios de granos." : ""}`;

  const user = [
    "Datos para el resumen (JSON):",
    JSON.stringify(
      {
        perfil_usuario: {
          nombre: perfil.nombre,
          provincia: perfil.provincia,
          partido: perfil.partido,
          lat: perfil.lat,
          lng: perfil.lng,
          tipo_comercializacion: perfil.tipo_comercializacion || "disponible",
          cultivos,
        },
        precios_cultivos: precios,
        tipo_cambio: tipoCambio,
        clima_7_dias: clima,
      },
      null,
      2
    ),
  ].join("\n\n");

  return { system, user };
};

const formatearMoneda = (valor, moneda = "ARS") => {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "s/d";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: moneda,
    maximumFractionDigits: moneda === "USD" ? 2 : 0,
  }).format(n);
};

const construirResumenFallback = ({ perfil, fecha, metricas, tipoCambio, clima, sinSaludoInicial = false }) => {
  const preciosTxt = (metricas || [])
    .map((m) => {
      const varTxt =
        typeof m.variacion_ars === "number"
          ? m.variacion_ars > 0
            ? `▲ ${m.variacion_ars}`
            : m.variacion_ars < 0
            ? `▼ ${Math.abs(m.variacion_ars)}`
            : "▲ 0"
          : "▲ sin dato prev.";
      return `- ${m.cultivo}: ${formatearMoneda(m.precio_ars, "ARS")} | ${formatearMoneda(m.precio_usd, "USD")} (${varTxt})`;
    })
    .join("\n");

  const tcTxt = (tipoCambio?.items || [])
    .filter((t) => ["oficial", "blue", "bolsa", "ccl", "mep"].includes(String(t.tipo).toLowerCase()))
    .map((t) => `- ${t.tipo}: ${formatearMoneda(t.valor, "ARS")}`)
    .join("\n");

  const climaTxt = (clima || [])
    .slice(0, 3)
    .map(
      (c) =>
        `- ${String(c.fecha).slice(0, 10)}: ${c.descripcion || "s/d"} (${c.temp_min}°/${c.temp_max}°)${
          c.helada ? " - Alerta helada" : ""
        }`
    )
    .join("\n");

  const cabecera = sinSaludoInicial
    ? [`📅 *Resumen AgroHabilis* - ${fecha}`, ""]
    : [`🌾 *Buenos días, ${perfil.nombre || "productor"}!*`, `📅 Resumen AgroHabilis - ${fecha}`, ""];
  return [
    ...cabecera,
    "💰 *PRECIOS DEL DÍA*",
    preciosTxt || "- Sin datos de precios para tus cultivos.",
    "",
    "💵 *TIPO DE CAMBIO*",
    tcTxt || "- Sin datos de tipo de cambio.",
    "",
    `🌤️ *CLIMA EN ${perfil.partido || "tu zona"}*`,
    climaTxt || "- Sin datos de clima.",
    "",
    "📊 *TU SITUACIÓN*",
    "Hoy te conviene priorizar decisiones con los precios vigentes y revisar costos por cultivo.",
    "",
    "💡 *CONSEJO DEL DÍA*",
    "Si hay riesgo de helada en tu zona, adelantá tareas sensibles de implantación.",
  ].join("\n");
};

const construirBloqueTipoCambio = ({ tipoCambio }) => {
  const formatearFechaCorta = (fecha) => {
    if (!fecha) return "s/f";
    const d = new Date(fecha);
    if (!Number.isFinite(d.getTime())) return "s/f";
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
    }).format(d);
  };
  const items = Array.isArray(tipoCambio?.items) ? tipoCambio.items : [];
  if (!items.length) return "💵 *TIPO DE CAMBIO*\n- Sin datos de tipo de cambio.";
  const byTipo = new Map(items.map((it) => [String(it?.tipo || "").toLowerCase(), it]));
  const orden = [
    ["oficial", "Oficial"],
    ["blue", "Blue"],
    ["mep", "MEP"],
    ["ccl", "CCL"],
  ];
  const lineas = [];
  for (const [k, label] of orden) {
    const tc = byTipo.get(k);
    if (!tc) continue;
    const compra = Number(tc.compra);
    const venta = Number(tc.valor);
    const compraTxt = Number.isFinite(compra) ? `compra ${formatearMoneda(compra, "ARS")}` : null;
    const ventaTxt = Number.isFinite(venta) ? `venta ${formatearMoneda(venta, "ARS")}` : "venta s/d";
    const cvTxt = compraTxt ? `${compraTxt} | ${ventaTxt}` : ventaTxt;
    const fechaTxt = formatearFechaCorta(tc?.fecha);
    const fuenteTxt = tc?.fuente ? String(tc.fuente) : "ref";
    lineas.push(`- ${label}: ${cvTxt} (${fechaTxt}, ${fuenteTxt})`);
  }
  if (!lineas.length) return "💵 *TIPO DE CAMBIO*\n- Sin datos de tipo de cambio.";
  return ["💵 *TIPO DE CAMBIO*", ...lineas].join("\n");
};

const inyectarBloqueTipoCambio = (texto = "", bloqueTipoCambio = "") => {
  if (!bloqueTipoCambio) return texto;
  const patronConClima = /💵 \*TIPO DE CAMBIO\*[\s\S]*?(?=\n\n🌤️ \*CLIMA EN)/;
  if (patronConClima.test(texto)) {
    return texto.replace(patronConClima, bloqueTipoCambio);
  }
  const patronSimple = /💵 \*TIPO DE CAMBIO\*[\s\S]*?(?=\n\n)/;
  if (patronSimple.test(texto)) {
    return texto.replace(patronSimple, bloqueTipoCambio);
  }
  return `${texto}\n\n${bloqueTipoCambio}`;
};

const filtrarNoticiasPorPerfil = ({
  noticias = [],
  perfilTipo = "agricultura",
  cultivos = [],
  maxSalida = 60,
}) => {
  const palabrasCultivos = cultivos
    .map((c) => normalizar(c.cultivo || c))
    .filter(Boolean);
  const perfilPapa = palabrasCultivos.includes("papa") || palabrasCultivos.includes("patata");
  const esGanaderia = String(perfilTipo || "").toLowerCase() === "ganaderia";
  const esMixto = String(perfilTipo || "").toLowerCase() === "mixto";

  const reNoDeseado = /(dolar|dólar|euro|bitcoin|cripto|wall street|acciones|plazo fijo|city)\b/i;
  const reAgroGeneral = /(agro|campo|cosecha|siembra|mercado|matba|rofex|grano|trigo|maiz|maíz|soja|girasol|sorgo|papa)/i;
  const reGanaderia = /(ganad|hacienda|novill|terner|vaca|vaquill|feedlot|carne|faena|invernada|cria|cría|porcin|ovin|caprin|llama|alpaca)/i;

  const puntuar = (n) => {
    const titulo = limpiarTitulo(n.titulo || "");
    if (!titulo) return -999;
    if (reNoDeseado.test(titulo) && !reAgroGeneral.test(titulo) && !reGanaderia.test(titulo)) return -100;
    let score = 0;
    if (reAgroGeneral.test(titulo)) score += 2;
    if (reGanaderia.test(titulo)) score += esGanaderia || esMixto ? 4 : 1;
    if (palabrasCultivos.some((k) => titulo.toLowerCase().includes(k))) score += 4;
    const fuente = String(n.fuente || "").toLowerCase();
    const categoria = String(n.categoria || "").toLowerCase();
    if (
      perfilPapa &&
      (categoria.includes("horticola_contexto") ||
        (fuente.includes("inta") && /(papa|hortic)/i.test(titulo)))
    ) {
      score += 6;
    }
    if (fuente.includes("infocampo") || fuente.includes("todoagro") || fuente.includes("noticias de campo")) {
      score += 1;
    }
    const t = new Date(n.publicado_en || 0).getTime();
    if (Number.isFinite(t)) score += t / 1e15;
    return score;
  };

  return noticias
    .map((n) => ({ ...n, titulo: limpiarTitulo(n.titulo || ""), _score: puntuar(n) }))
    .filter((n) => n._score > -50 && n.titulo)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxSalida)
    .map(({ _score, ...rest }) => rest);
};

const CULTIVO_ALIAS_NOTICIAS = {
  maiz: ["maiz", "maíz"],
  soja: ["soja", "soy"],
  trigo: ["trigo", "triguero"],
  cebada: ["cebada", "cebadero"],
  sorgo: ["sorgo"],
  girasol: ["girasol"],
  papa: ["papa", "patata"],
  maní: ["mani", "maní"],
  arroz: ["arroz", "arrocero"],
};

const aliasesCultivoUsuario = (cultivos = []) => {
  const out = [];
  for (const c of cultivos) {
    const base = normalizar(c.cultivo || c);
    if (!base) continue;
    out.push(base);
    const alias = CULTIVO_ALIAS_NOTICIAS[base];
    if (Array.isArray(alias)) out.push(...alias.map((a) => normalizar(a)));
  }
  return Array.from(new Set(out)).filter(Boolean);
};

const noticiaVinculadaCultivoUsuario = (n, cultivos = []) => {
  const blob = normalizar(
    `${limpiarTitulo(n?.titulo || "")} ${limpiarTextoPlano(n?.resumen || "", 500)} ${String(
      n?.categoria || ""
    )}`
  );
  if (!blob) return false;
  const alias = aliasesCultivoUsuario(cultivos);
  if (!alias.length) return true;
  return alias.some((k) => blob.includes(k));
};

const claveDia = (v) => {
  const d = new Date(v || "");
  if (!Number.isFinite(d.getTime())) return "s/f";
  return d.toISOString().slice(0, 10);
};

const elegirNoticiasVentana3Dias = (noticias = [], maxTotal = 9, maxPorDia = 3, cultivos = []) => {
  const out = [];
  const vistos = new Set();

  const hoy = new Date();
  const diasObjetivo = [0, 1, 2].map((delta) => {
    const d = new Date(hoy);
    d.setUTCDate(d.getUTCDate() - delta);
    return d.toISOString().slice(0, 10);
  });

  for (const dia of diasObjetivo) {
    const candidatosDia = noticias.filter((n) => claveDia(n.publicado_en || n.creado_en) === dia);
    const vinculadas = candidatosDia.filter((n) => noticiaVinculadaCultivoUsuario(n, cultivos));
    const generales = candidatosDia.filter((n) => !noticiaVinculadaCultivoUsuario(n, cultivos));
    const ordenDia = [...vinculadas, ...generales];
    let agregadosDia = 0;
    for (const n of ordenDia) {
      const key = `${dia}|${normalizar(limpiarTitulo(n.titulo || ""))}`;
      if (!key || vistos.has(key)) continue;
      vistos.add(key);
      out.push(n);
      agregadosDia += 1;
      if (agregadosDia >= maxPorDia || out.length >= maxTotal) break;
    }
    if (out.length >= maxTotal) break;
  }
  return out;
};

const resumenInutil = (resumen = "", titulo = "") => {
  const r = normalizar(limpiarTextoPlano(resumen, 420));
  const t = normalizar(limpiarTitulo(titulo || ""));
  if (!r) return true;
  if (r.length < 35) return true;
  if (t && (r === t || r.startsWith(t))) return true;
  return false;
};

const extraerResumenDesdeHtml = (html = "", titulo = "") => {
  const $ = require("cheerio").load(String(html || ""));
  const metaDesc =
    $("meta[name='description']").attr("content") ||
    $("meta[property='og:description']").attr("content") ||
    "";
  const lead =
    $("article p").first().text() ||
    $(".entry-content p").first().text() ||
    $(".post-content p").first().text() ||
    "";
  const candidato = limpiarTextoPlano(metaDesc || lead, 420);
  if (!candidato) return null;
  if (resumenInutil(candidato, titulo)) return null;
  return candidato;
};

const obtenerBajadaDesdeUrl = async ({ url, titulo }) => {
  const u = String(url || "").trim();
  if (!/^https?:\/\//i.test(u)) return null;
  try {
    const r = await axios.get(u, {
      timeout: 20_000,
      headers: { "User-Agent": "AgroHabilis/1.0 (+resumen-noticias)" },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return extraerResumenDesdeHtml(r.data, titulo);
  } catch (_e) {
    return null;
  }
};

const enriquecerBajadasNoticias = async (noticias = []) => {
  const out = [];
  for (const n of noticias) {
    const titulo = limpiarTitulo(n.titulo || "");
    let resumen = limpiarTextoPlano(n.resumen || "", 420);
    if (resumenInutil(resumen, titulo)) {
      const scrape = await obtenerBajadaDesdeUrl({ url: n.url, titulo });
      if (scrape) {
        resumen = scrape;
        if (n.url) {
          try {
            await query(
              `
                UPDATE noticias_agro
                SET resumen = $2
                WHERE url = $1
              `,
              [n.url, resumen]
            );
          } catch (_e) {
            // best effort
          }
        }
      }
    }
    out.push({ ...n, titulo, resumen });
  }
  return out;
};

const construirSeccionComercializacion = ({
  tipoComercializacion,
  metricas = [],
  futuros = [],
}) => {
  const tipo = String(tipoComercializacion || "disponible").toLowerCase();
  const metricasDisponibles = metricas.filter(
    (m) => Number.isFinite(Number(m.precio_ars)) || Number.isFinite(Number(m.precio_usd))
  );

  if (tipo === "disponible") {
    return "";
  }

  if (tipo === "futuros" || tipo === "mixto") {
    const futurosByCultivo = new Map();
    for (const f of futuros) {
      const key = normalizar(f.cultivo);
      if (!futurosByCultivo.has(key)) futurosByCultivo.set(key, []);
      futurosByCultivo.get(key).push(f);
    }

    const lineas = ["📊 *DISPONIBLE vs FUTURO*"];
    for (const m of metricasDisponibles) {
      lineas.push(`${m.cultivo} disponible: ${formatearMoneda(m.precio_usd, "USD")}`);
      const futurosCultivo = futurosByCultivo.get(normalizar(m.cultivo)) || [];
      for (const f of futurosCultivo.slice(0, 2)) {
        const base =
          Number.isFinite(Number(m.precio_usd)) && Number.isFinite(Number(f.precio_usd))
            ? Number(
                (
                  ((Number(f.precio_usd) - Number(m.precio_usd)) / Number(m.precio_usd)) *
                  100
                ).toFixed(2)
              )
            : null;
        const baseTxt = Number.isFinite(base) ? `${base >= 0 ? "+" : ""}${base}%` : "s/d";
        lineas.push(
          `${m.cultivo} futuro ${f.posicion}: ${formatearMoneda(f.precio_usd, "USD")} (${baseTxt})`
        );
      }
    }
    if (lineas.length === 1) lineas.push("Sin datos de disponible/futuro para comparar.");
    lineas.push("→ Revisá la base disponible/futuro antes de cerrar precio.");
    return lineas.join("\n");
  }

  const lineas = metricasDisponibles
    .slice(0, 4)
    .map(
      (m) =>
        `${m.cultivo}: ${formatearMoneda(m.precio_ars, "ARS")} / ${formatearMoneda(m.precio_usd, "USD")}`
    );
  return [
    "📊 *PRECIO DISPONIBLE HOY*",
    ...(lineas.length ? lineas : ["Sin datos disponibles."]),
    "",
    "💡 ¿Sabías que podés fijar hoy precio futuro con contratos MATba-Rofex?",
  ].join("\n");
};

const construirSeccionPerfilProductivo = async ({ perfil, usuarioId, hectareasTotales }) => {
  const perfilTipo = perfil.perfil_productivo || "agricultura";
  const financiero = await obtenerResumenFinanciero(usuarioId);
  const byPerfil = new Map(financiero.porPerfil.map((p) => [p.perfil, p]));

  const secciones = [];
  if (perfilTipo === "agricultura" || perfilTipo === "mixto") {
    const a = byPerfil.get("agricultura") || { gastos: 0, ventas: 0, margen: 0 };
    const margenHa =
      Number(hectareasTotales) > 0
        ? Number((a.margen / Number(hectareasTotales)).toFixed(2))
        : a.margen;
    secciones.push([
      "💰 *TU CAMPAÑA*",
      `Gastos registrados este mes: ${formatearMoneda(a.gastos, "ARS")}`,
      `Ventas registradas: ${formatearMoneda(a.ventas, "ARS")}`,
      `Margen actual: ${formatearMoneda(margenHa, "ARS")}/ha`,
    ].join("\n"));
  }

  if (perfilTipo === "ganaderia" || perfilTipo === "mixto") {
    const perfilGanaderoResult = await query(
      `
        SELECT especie, categoria, cantidad_estimada
        FROM usuario_ganaderia_perfil
        WHERE usuario_id = $1 AND activo = true
        ORDER BY especie, categoria
      `,
      [usuarioId]
    );
    const perfilGanadero = perfilGanaderoResult.rows || [];
    const categoriasPreferidas = perfilGanadero.map((p) => normalizar(p.categoria)).filter(Boolean);
    const especiesDeclaradas = [...new Set(perfilGanadero.map((p) => p.especie).filter(Boolean))];

    let precioRef = null;
    if (categoriasPreferidas.length) {
      const precioPreferido = await query(
        `
          SELECT categoria, precio_promedio, fecha
          FROM precios_hacienda
          WHERE lower(categoria) = ANY($1::text[])
          ORDER BY fecha DESC
          LIMIT 1
        `,
        [categoriasPreferidas]
      );
      precioRef = precioPreferido.rows[0] || null;
    }
    if (!precioRef) {
      const precioNovilloResult = await query(
        `
          SELECT categoria, precio_promedio, fecha
          FROM precios_hacienda
          WHERE categoria IN ('novillo', 'novillito', 'ternero')
          ORDER BY fecha DESC
          LIMIT 1
        `
      );
      precioRef = precioNovilloResult.rows[0] || null;
    }

    let referenciaWeb = null;
    if (!precioRef && (!especiesDeclaradas.length || especiesDeclaradas.includes("vacuno"))) {
      try {
        const r = await axios.get("https://www.infocampo.com.ar/category/mercados-y-empresas/", {
          timeout: 20000,
          headers: { "User-Agent": "AgroHabilis/1.0 (soporte@agrohabilis.com)" },
        });
        const texto = String(r.data || "").replace(/<[^>]*>/g, " ");
        const m = texto.match(/novill(?:ito|o)[^\d]{0,40}(\d[\d\.\,]*)/i);
        const bruto = m?.[1] || "";
        const limpio = bruto.replace(/\./g, "").replace(",", ".");
        const precio = Number(limpio);
        if (Number.isFinite(precio) && precio > 0) {
          referenciaWeb = { categoria: "novillito", precio_promedio: precio, fuente: "InfoCampo web (en vivo)" };
        }
      } catch (_err) {
        referenciaWeb = null;
      }
    }

    const stockResult = await query(
      `
        SELECT COALESCE(SUM(cantidad), 0)::int AS total
        FROM stock_ganadero
        WHERE usuario_id = $1
          AND fecha = (SELECT MAX(fecha) FROM stock_ganadero WHERE usuario_id = $1)
      `,
      [usuarioId]
    );
    const precioUsado = precioRef || referenciaWeb || null;
    const precioNovillo = Number(precioUsado?.precio_promedio) || 0;
    const stockTotal = Number(stockResult.rows[0]?.total) || 0;
    const valorRodeo = precioNovillo > 0 && stockTotal > 0 ? precioNovillo * stockTotal * 300 : 0;
    const categoriaRef = precioUsado?.categoria || "referencia";
    const fuenteRef = referenciaWeb ? " (fuente web en vivo)" : "";
    secciones.push(
      [
        "🐄 *TU HACIENDA*",
        especiesDeclaradas.length
          ? `Especies declaradas: ${especiesDeclaradas.join(", ")}`
          : "Especies declaradas: sin detalle (podés cargar con MI GANADO ...)",
        precioNovillo > 0
          ? `Precio ${categoriaRef} hoy: ${formatearMoneda(precioNovillo, "ARS")}/kg${fuenteRef}`
          : "Precio de referencia: sin dato específico para hoy",
        `Tu stock: ${stockTotal} cabezas`,
        `Valor estimado del rodeo: ${formatearMoneda(valorRodeo, "ARS")}`,
        precioNovillo > 0
          ? ""
          : "Tip: cargá categorías específicas (ej. MI GANADO vacuno novillo, porcino madres) para mejorar la precisión.",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return secciones.join("\n\n");
};

const construirSenalDelDia = async ({ perfil, metricas = [] }) => {
  const filas = [];
  for (const m of metricas) {
    const precioUsd = Number(m.precio_usd);
    if (!Number.isFinite(precioUsd) || precioUsd <= 0) continue;
    const costo = await calcularCostoPorHa(perfil, m.cultivo);
    const cultivoNorm = normalizar(m.cultivo);
    const rendimientoBase = cultivoNorm.includes("soja")
      ? 3
      : cultivoNorm.includes("maiz")
      ? 8
      : cultivoNorm.includes("trigo")
      ? 3.5
      : 2.5;
    const margenHa = Number((precioUsd * rendimientoBase - Number(costo.costo_estimado)).toFixed(2));
    const margenPct =
      Number(costo.costo_estimado) > 0
        ? Number(((margenHa / Number(costo.costo_estimado)) * 100).toFixed(1))
        : null;
    const tendencia = Number(m.variacion_ars);
    const señal =
      Number.isFinite(margenPct) && margenPct > 0
        ? `margen ${margenPct}% ✅`
        : "margen ajustado ⚠️";
    const tendenciaTxt = Number.isFinite(tendencia)
      ? tendencia > 0
        ? "precio en tendencia alcista"
        : tendencia < 0
        ? "precio en corrección"
        : "precio estable"
      : "tendencia s/d";
    filas.push(
      `${m.cultivo}: ${señal} — ${tendenciaTxt}\n→ Escribí ANALIZAR ${String(m.cultivo || "").toUpperCase()} para el análisis completo`
    );
  }
  if (!filas.length) return "";
  return ["📊 *SEÑAL DEL DÍA*", ...filas.slice(0, 2)].join("\n");
};

const construirInsightsPro = ({ metricas = [], futuros = [], clima = [] }) => {
  const futurosByCultivo = new Map();
  for (const f of futuros) {
    const key = normalizar(f.cultivo);
    if (!futurosByCultivo.has(key)) futurosByCultivo.set(key, []);
    futurosByCultivo.get(key).push(f);
  }

  const lineas = [];
  for (const m of metricas.slice(0, 2)) {
    const cultivoKey = normalizar(m.cultivo);
    const f = (futurosByCultivo.get(cultivoKey) || [])[0];
    const dispUsd = Number(m.precio_usd);
    const futUsd = Number(f?.precio_usd);
    const spread =
      Number.isFinite(dispUsd) && Number.isFinite(futUsd) && dispUsd > 0
        ? Number((((futUsd - dispUsd) / dispUsd) * 100).toFixed(1))
        : null;
    const varArs = Number(m.variacion_ars);
    const tendenciaTxt = Number.isFinite(varArs)
      ? `${varArs >= 0 ? "▲" : "▼"} ${Math.abs(varArs)} ARS`
      : "variación s/d";
    if (spread !== null) {
      lineas.push(
        `${m.cultivo}: spread futuro/disponible ${spread >= 0 ? "+" : ""}${spread}% y ${tendenciaTxt} vs rueda previa.`
      );
    } else {
      lineas.push(`${m.cultivo}: ${tendenciaTxt}.`);
    }
  }

  const lluvia72h = (clima || [])
    .slice(0, 3)
    .reduce((acc, c) => acc + (Number.isFinite(Number(c.precipitacion)) ? Number(c.precipitacion) : 0), 0);
  const riesgoHelada = (clima || []).slice(0, 3).some((c) => Boolean(c.helada));
  lineas.push(
    `Zona 72h: ${riesgoHelada ? "riesgo de helada" : "sin heladas relevantes"} | lluvia estimada ${lluvia72h.toFixed(
      1
    )} mm.`
  );

  lineas.push("Acción sugerida: escalonar ventas y activar alertas por cultivo cuando el spread supere +2%.");
  return ["🧠 *INSIGHTS PRO (PRODUCTO + ZONA)*", ...lineas].join("\n");
};

const construirBloqueOportunidadVenta = ({ metricas = [], futuros = [] }) => {
  const futurosByCultivo = new Map();
  for (const f of futuros) {
    const key = normalizar(f.cultivo);
    if (!futurosByCultivo.has(key)) futurosByCultivo.set(key, []);
    futurosByCultivo.get(key).push(f);
  }
  const oportunidades = [];
  for (const m of metricas.slice(0, 3)) {
    const dispUsd = Number(m.precio_usd);
    const f = (futurosByCultivo.get(normalizar(m.cultivo)) || [])[0];
    const futUsd = Number(f?.precio_usd);
    if (!Number.isFinite(dispUsd) || !Number.isFinite(futUsd) || dispUsd <= 0) continue;
    const spread = Number((((futUsd - dispUsd) / dispUsd) * 100).toFixed(1));
    const variacion = Number(m.variacion_ars);
    if (spread >= 2 || (Number.isFinite(variacion) && variacion > 0)) {
      oportunidades.push(
        `${m.cultivo}: spread ${spread >= 0 ? "+" : ""}${spread}% (futuro/disponible). Sugerencia: fijar 15%-25% en tramos.`
      );
    }
  }
  return [
    "🎯 *OPORTUNIDAD DE VENTA (48/72h)*",
    ...(oportunidades.length
      ? oportunidades.slice(0, 2)
      : ["Sin señal de ejecución inmediata. Mantener alertas activas y revisar en 24h."]),
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
  const vientoFuerte = prox.some((c) =>
    String(c.descripcion || "")
      .toLowerCase()
      .includes("viento")
  );
  const alertas = [];
  if (helada) alertas.push("helada");
  if (lluviaAlta) alertas.push(`lluvia alta (${lluvia72h.toFixed(1)} mm)`);
  if (vientoFuerte) alertas.push("viento relevante");
  return [
    "⚠️ *RIESGOS OPERATIVOS (SEMANA)*",
    `${alertas.length ? `Atención: ${alertas.join(", ")}.` : "Sin riesgos climáticos críticos para 72h."}`,
    "Sugerencia: ajustar aplicaciones/labores según ventana climática diaria.",
  ].join("\n");
};

const construirBloquesProExtra = ({ metricas = [], tipoCambio = { items: [] }, clima = [] }) => {
  const tcMap = new Map(
    (tipoCambio?.items || []).map((r) => [String(r.tipo || "").toLowerCase(), Number(r.valor)])
  );
  const oficial = tcMap.get("oficial");
  const mep = tcMap.get("mep") || tcMap.get("bolsa");
  const brecha =
    Number.isFinite(oficial) && Number.isFinite(mep) && oficial > 0
      ? Number((((mep - oficial) / oficial) * 100).toFixed(1))
      : null;

  const primer = metricas[0];
  const precioUsd = Number(primer?.precio_usd);
  const escenario =
    Number.isFinite(precioUsd) && precioUsd > 0
      ? `${primer.cultivo}: escenario +5% = USD ${(precioUsd * 1.05).toFixed(0)}/tn | -5% = USD ${(
          precioUsd * 0.95
        ).toFixed(0)}/tn.`
      : "Sin datos de precio USD para escenarios hoy.";

  const lluvia72h = (clima || [])
    .slice(0, 3)
    .reduce((acc, c) => acc + (Number.isFinite(Number(c.precipitacion)) ? Number(c.precipitacion) : 0), 0);

  return [
    [
      "🧪 *ESCENARIOS RÁPIDOS (PRO)*",
      escenario,
      `Brecha cambiaria (MEP vs Oficial): ${brecha === null ? "s/d" : `${brecha}%`}.`,
    ].join("\n"),
    [
      "⛽ *TERMÓMETRO OPERATIVO (PRO)*",
      `Lluvia 72h: ${lluvia72h.toFixed(1)} mm.`,
      "Impacto esperado: si supera 20 mm, priorizar logística y labores en lotes con mejor piso.",
    ].join("\n"),
    [
      "🔔 *ALERTAS SUGERIDAS (PRO)*",
      "1) Avisame si spread futuro/disponible > +2%.",
      "2) Avisame por riesgo de helada en 72h.",
      "3) Avisame si MEP cambia +/-2% en el día.",
    ].join("\n"),
  ];
};

const obtenerRadarWeb = async ({ perfilTipo = "agricultura", cultivos = [] } = {}) => {
  const noticiasResult = await query(
    `
      SELECT fuente, categoria, titulo, url, resumen, publicado_en
      FROM noticias_agro
      WHERE COALESCE(publicado_en, creado_en) >= CURRENT_DATE - INTERVAL '2 days'
      ORDER BY COALESCE(publicado_en, creado_en) DESC
      LIMIT 60
    `
  );
  const fechaMercadoResult = await query(
    `
      SELECT MAX(fecha) AS fecha
      FROM precios
      WHERE mercado ILIKE '%WEB%'
    `
  );
  const fechaMercado = fechaMercadoResult.rows[0]?.fecha;
  let mercados = [];
  if (fechaMercado) {
    const mercadosResult = await query(
      `
        SELECT cultivo, mercado, precio, moneda, fecha
        FROM precios
        WHERE fecha = $1
          AND mercado ILIKE '%WEB%'
        ORDER BY cultivo, mercado
      `,
      [fechaMercado]
    );
    mercados = mercadosResult.rows;
  }
  let noticias = noticiasResult.rows || [];
  if (!noticias.length) {
    const fuentesWp = [
      { fuente: "InfoCampo", url: "https://www.infocampo.com.ar/wp-json/wp/v2/posts" },
      { fuente: "Noticias de Campo", url: "https://www.noticiasdecampo.com/wp-json/wp/v2/posts" },
      { fuente: "TodoAgro", url: "https://www.todoagro.com.ar/wp-json/wp/v2/posts" },
    ];
    const fallback = [];
    for (const f of fuentesWp) {
      try {
        const r = await axios.get(f.url, {
          timeout: 15000,
          params: { per_page: 4, _fields: "title,link,date", orderby: "date", order: "desc" },
          validateStatus: (s) => s >= 200 && s < 300,
        });
        const items = Array.isArray(r.data) ? r.data : [];
        for (const it of items) {
          const titulo = limpiarTitulo(it?.title?.rendered || "");
          if (!titulo) continue;
          fallback.push({
            fuente: f.fuente,
            categoria: "agro_general",
            titulo,
            url: it?.link || null,
            resumen: null,
            publicado_en: it?.date || null,
          });
        }
      } catch (_error) {
        // best effort
      }
    }
    noticias = fallback.slice(0, 12);
  }
  noticias = filtrarNoticiasPorPerfil({ noticias, perfilTipo, cultivos, maxSalida: 60 });
  noticias = elegirNoticiasVentana3Dias(noticias, 9, 3, cultivos);
  noticias = await enriquecerBajadasNoticias(noticias);

  if (!mercados.length) {
    try {
      const web = await obtenerMercadosWeb();
      mercados = (web.items || []).slice(0, 8).map((m) => ({
        cultivo: m.cultivo,
        mercado: m.mercado,
        precio: Number.isFinite(Number(m.precio_ars)) ? Number(m.precio_ars) : Number(m.precio_usd),
        moneda: Number.isFinite(Number(m.precio_ars)) ? "ARS" : "USD",
        fecha: m.fecha,
      }));
    } catch (_error) {
      // best effort
    }
  }
  return { noticias, mercados };
};

const construirBloqueRadarWebPro = ({ noticias = [], mercados = [], noticiasMax = 8 }) => {
  const vistos = new Set();
  const titulares = noticias
    .filter((n) => {
      const key = normalizar(limpiarTitulo(n?.titulo || ""));
      if (!key || vistos.has(key)) return false;
      vistos.add(key);
      return true;
    })
    .slice(0, noticiasMax)
    .map((n) => {
      const titulo = limpiarTitulo(n?.titulo || "");
      const resumen = String(n?.resumen || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 520);
      const resumenUtil =
        resumen &&
        normalizar(resumen) !== normalizar(titulo) &&
        !normalizar(resumen).startsWith(normalizar(titulo))
          ? resumen
          : "Sin bajada disponible en la fuente.";
      return [`- ${titulo} (${n.fuente})`, resumenUtil].join("\n");
    });
  const preciosMercado = mercados
    .slice(0, 5)
    .map((m) => `- ${m.cultivo} ${m.mercado}: ${formatearMoneda(m.precio, m.moneda || "ARS")}`);
  return [
    "🗞️ *RADAR WEB PRO (Noticias + Mercado)*",
    titulares.length ? "Titulares clave:\n" + titulares.join("\n") : "Titulares clave: sin datos recientes.",
    "",
    preciosMercado.length
      ? `Mercado web (${String(mercados[0]?.fecha || "").slice(0, 10)}):\n${preciosMercado.join("\n")}`
      : "Mercado web: sin datos recientes.",
  ].join("\n");
};

const construirMuestraTrialNoPro = ({ noticias = [], mercados = [], noticiasMax = 9 }) => {
  const muestras = [];
  for (const n of noticias.slice(0, noticiasMax)) {
    const titulo = limpiarTitulo(n.titulo || "");
    const resumen = String(n?.resumen || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 340);
    const resumenUtil =
      resumen &&
      normalizar(resumen) !== normalizar(titulo) &&
      !normalizar(resumen).startsWith(normalizar(titulo))
        ? resumen
        : "Resumen breve no disponible en la fuente.";
    muestras.push([`- 📰 ${titulo} (${n.fuente})`, resumenUtil].join("\n"));
  }
  if (mercados[0]) {
    muestras.push(
      `- 📈 ${mercados[0].cultivo} ${mercados[0].mercado}: ${formatearMoneda(
        mercados[0].precio,
        mercados[0].moneda || "ARS"
      )}`
    );
  }
  return [
    `🔎 *MUESTRA PRO (${Math.min(noticiasMax, 9)})*`,
    ...(muestras.length ? muestras.slice(0, noticiasMax) : ["- Sin muestra disponible hoy."]),
    "Para ver el bloque completo (noticias + mercado web), escribí: QUIERO PLAN PRO",
  ].join("\n");
};

const generarResumen = async (usuarioOrId, opciones = {}) => {
  const sinSaludoInicial = Boolean(opciones?.sinSaludoInicial);
  let perfil = null;
  if (typeof usuarioOrId === "object" && usuarioOrId?.id) {
    perfil = await obtenerPerfilPorId(usuarioOrId.id);
  } else if (typeof usuarioOrId === "number") {
    perfil = await obtenerPerfilPorId(usuarioOrId);
  } else {
    perfil = await obtenerPerfil(normalizarWhatsapp(usuarioOrId));
  }

  if (!perfil) {
    throw new Error("No existe usuario para generar resumen");
  }

  const perfilGeo = await asegurarGeolocalizacion(perfil);
  const cultivos = perfilGeo.cultivos || [];
  const precios = await obtenerPreciosCultivosUsuario(cultivos.map((c) => c.cultivo));
  const futuros = await obtenerFuturosPosicionesUsuario(cultivos.map((c) => c.cultivo));
  let tipoCambio = await obtenerTipoCambioDia();
  const oficial = (tipoCambio.items || []).find((t) => String(t.tipo || "").toLowerCase() === "oficial");
  const oficialMs = oficial?.fecha ? new Date(oficial.fecha).getTime() : 0;
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);
  if (!oficialMs || oficialMs < hoyInicio.getTime()) {
    try {
      const vivo = await obtenerTipoCambio();
      await persistirTiposCambioDesdeScraper(vivo, "dolarapi");
      tipoCambio = await obtenerTipoCambioDia();
    } catch (error) {
      console.warn("[Resumen] No se pudo refrescar tipo de cambio para resumen:", error.message);
    }
  }
  const clima = await obtenerClimaZona(perfilGeo);
  const metricas = calcularMetricaCultivos(cultivos, precios.items);
  const detalleFuentesPrecios = await obtenerDetallePreciosPorFuentes(cultivos.map((c) => c.cultivo));
  const hectareasTotales = cultivos.reduce((acc, c) => acc + (Number(c.hectareas) || 0), 0);
  const seccionPerfil = await construirSeccionPerfilProductivo({
    perfil: perfilGeo,
    usuarioId: perfilGeo.id,
    hectareasTotales,
  });
  const seccionComercializacion = construirSeccionComercializacion({
    tipoComercializacion: perfilGeo.tipo_comercializacion,
    metricas,
    futuros,
  });
  const senalDelDia = await construirSenalDelDia({
    perfil: perfilGeo,
    metricas,
  });
  const fechaResumen = toISODate(new Date());
  const planEfectivo = resolverPlanEfectivo({
    plan: perfilGeo.plan,
    planActivoHasta: perfilGeo.plan_activo_hasta,
  });
  const esGratis = planEfectivo === "gratis";
  const esBasico = planEfectivo === "basico";
  const esPro = planEfectivo === "pro";
  const noticiasMax = esPro
    ? Math.max(1, Math.min(15, Number(perfilGeo.noticias_cantidad_pref) || 8))
    : esBasico
    ? 5
    : 2;
  const tieneBloquesPlus = esBasico || esPro;
  const radarWeb = await obtenerRadarWeb({
    perfilTipo: perfilGeo.perfil_productivo,
    cultivos,
  });
  const { system, user } = armarPromptResumen({
    perfil: perfilGeo,
    fecha: fechaResumen,
    cultivos: metricas,
    precios,
    tipoCambio,
    clima,
    sinSaludoInicial,
  });

  const esGanaderoSinCultivos =
    String(perfilGeo.perfil_productivo || "").toLowerCase() === "ganaderia" && !cultivos.length;
  let ia;
  if (esGanaderoSinCultivos) {
    ia = {
      texto: construirResumenFallback({
        perfil: perfilGeo,
        fecha: fechaResumen,
        metricas: [],
        tipoCambio,
        clima,
        sinSaludoInicial,
      }),
      tokensUsados: null,
      model: "fallback-ganaderia-sin-cultivos",
    };
  } else {
    try {
      ia = await generarConPromptLibre({ system, user });
    } catch (error) {
      console.error("[Resumen] Fallaron todos los proveedores IA:", error.message);
      ia = {
        texto: construirResumenFallback({
          perfil: perfilGeo,
          fecha: fechaResumen,
          metricas,
          tipoCambio,
          clima,
          sinSaludoInicial,
        }),
        tokensUsados: null,
        model: "fallback-local",
      };
    }
  }
  if (seccionPerfil) {
    ia.texto = `${ia.texto}\n\n${seccionPerfil}`;
  }
  if (seccionComercializacion) {
    ia.texto = `${ia.texto}\n\n${seccionComercializacion}`;
  }
  if (senalDelDia) {
    ia.texto = `${ia.texto}\n\n${senalDelDia}`;
  }
  if (tieneBloquesPlus) {
    ia.texto = `${ia.texto}\n\n${construirBloqueOportunidadVenta({ metricas, futuros })}`;
    ia.texto = `${ia.texto}\n\n${construirBloqueRiesgosOperativos({ clima })}`;
  }
  if (esPro) {
    ia.texto = `${ia.texto}\n\n${construirInsightsPro({ metricas, futuros, clima })}`;
    const bloquesProExtra = construirBloquesProExtra({ metricas, tipoCambio, clima });
    ia.texto = `${ia.texto}\n\n${bloquesProExtra.join("\n\n")}`;
    ia.texto = `${ia.texto}\n\n${construirBloqueRadarWebPro({ ...radarWeb, noticiasMax })}`;
  } else {
    ia.texto = `${ia.texto}\n\n${construirMuestraTrialNoPro({ ...radarWeb, noticiasMax: 9 })}`;
  }
  if (esGratis) {
    ia.texto = `${ia.texto}\n\n📌 *PLAN GRATIS* ($0/mes)\nRecibís este resumen 2 veces por semana: al día siguiente de tu registro y luego todos los lunes y jueves.\nSi querés resumen diario, escribí: QUIERO PLAN BASICO ($9.000/mes) o QUIERO PLAN PRO ($18.000/mes).`;
  }
  ia.texto = inyectarBloquePrecios(ia.texto, construirBloquePreciosDetallado({ metricas, detalleFuentes: detalleFuentesPrecios }));
  ia.texto = inyectarBloqueTipoCambio(ia.texto, construirBloqueTipoCambio({ tipoCambio }));
  ia.texto = `${ia.texto}\n\n🛑 Si querés dejar de recibir el informe diario, escribí: *DETENER RESUMEN*`;
  const guardado = await guardarResumen({
    usuarioId: perfilGeo.id,
    texto: ia.texto,
    tokensUsados: ia.tokensUsados,
  });

  return {
    resumenId: guardado.id,
    usuario: perfilGeo,
    texto: ia.texto,
    model: ia.model,
    tokensUsados: ia.tokensUsados,
    contexto: {
      precios,
      tipoCambio,
      clima,
      metricas,
      futuros,
      tipo_comercializacion: perfilGeo.tipo_comercializacion,
    },
  };
};

module.exports = {
  generarResumen,
  marcarResumenEnviado,
};
