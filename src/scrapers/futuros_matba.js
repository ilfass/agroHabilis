require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

const API_BASE = "https://api.matbarofex.com.ar/v2/symbol";
const TOKEN_URL = "https://api.matbarofex.com.ar/v2/token/";
const REFRESH_URL = "https://api.matbarofex.com.ar/v2/token/refresh/";
const WEB_AGRO_URL = "https://matbarofex.com.ar/productos/agropecuarios";
const ACOPIAR_MATBA_URL = "https://www.acopiarsa.com.ar/matba.asp";
const AGROFY_FUTUROS_URL = "https://news.agrofy.com.ar/granos/futuros-opciones";

const INDICES = [
  { cultivo: "Soja", symbol: "I.SOJA" },
  { cultivo: "Maíz", symbol: "I.MAIZ" },
  { cultivo: "Trigo", symbol: "I.TRIGO" },
];

const POSICIONES = [
  { cultivo: "Soja", posicion: "MAY26", symbol: "SOJ/MAY26" },
  { cultivo: "Maíz", posicion: "JUL26", symbol: "MAI/JUL26" },
  { cultivo: "Trigo", posicion: "DIC26", symbol: "TRI/DIC26" },
];

const authState = {
  accessToken: null,
  refreshToken: null,
  accessExpireAt: 0,
  refreshExpireAt: 0,
};

const toIsoDate = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
};

const parseNumero = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const parseNumeroTexto = (value) => {
  const txt = String(value || "").trim();
  if (!txt) return null;
  const limpio = txt.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
};

const parseVencimientoDias = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const obtenerSymbol = async (symbol) => {
  const url = `${API_BASE}/${symbol}`;
  const token = await obtenerAccessToken();
  const doRequest = async (tokenToUse) =>
    axios.get(url, {
      timeout: 20_000,
      headers: {
        "User-Agent": "AgroHabilis/1.0",
        Accept: "application/json",
        ...(tokenToUse ? { Authorization: `Bearer ${tokenToUse}` } : {}),
      },
    });

  try {
    const response = await doRequest(token);
    return response.data;
  } catch (error) {
    if (error.response?.status !== 401) throw error;
    const refreshed = await refrescarToken();
    if (!refreshed || refreshed === token) throw error;
    const retry = await doRequest(refreshed);
    return retry.data;
  }
};

const ahora = () => Date.now();

const tieneCredenciales = () =>
  Boolean(process.env.MATBA_API_USERNAME && process.env.MATBA_API_PASSWORD);

const leerTokensDesdeEnv = () => {
  const fallback = leerTokensRawDesdeDotEnv();
  const accessToken =
    process.env.MATBA_ACCESS_TOKEN ||
    process.env.ACCESS_TOKEN ||
    fallback.MATBA_ACCESS_TOKEN ||
    fallback.ACCESS_TOKEN ||
    null;
  const refreshToken =
    process.env.MATBA_REFRESH_TOKEN ||
    process.env.REFRESH_TOKEN ||
    fallback.MATBA_REFRESH_TOKEN ||
    fallback.REFRESH_TOKEN ||
    null;
  return { accessToken, refreshToken };
};

const leerTokensRawDesdeDotEnv = () => {
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, "utf8");
    const out = {};
    for (const line of content.split(/\r?\n/)) {
      const clean = String(line || "").trim();
      if (!clean || clean.startsWith("#")) continue;
      const eqIdx = clean.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = clean.slice(0, eqIdx).trim();
      if (!["ACCESS_TOKEN", "REFRESH_TOKEN", "MATBA_ACCESS_TOKEN", "MATBA_REFRESH_TOKEN"].includes(key)) {
        continue;
      }
      out[key] = clean.slice(eqIdx + 1).trim();
    }
    return out;
  } catch (_error) {
    return {};
  }
};

const tokenVigente = () =>
  Boolean(authState.accessToken && authState.accessExpireAt > ahora() + 60_000);

const refreshVigente = () =>
  Boolean(authState.refreshToken && authState.refreshExpireAt > ahora() + 60_000);

const guardarTokens = ({ access, refresh }) => {
  if (access) {
    authState.accessToken = access;
    authState.accessExpireAt = ahora() + 24 * 60 * 60 * 1000;
  }
  if (refresh) {
    authState.refreshToken = refresh;
    authState.refreshExpireAt = ahora() + 7 * 24 * 60 * 60 * 1000;
  }
};

const bootstrapTokensDesdeEnv = () => {
  const { accessToken, refreshToken } = leerTokensDesdeEnv();
  if (accessToken && !authState.accessToken) {
    authState.accessToken = accessToken;
    // No tenemos expiry exacto, asumimos ventana corta para forzar refresh si existe.
    authState.accessExpireAt = ahora() + 15 * 60 * 1000;
  }
  if (refreshToken && !authState.refreshToken) {
    authState.refreshToken = refreshToken;
    // No tenemos expiry exacto, usamos un margen conservador.
    authState.refreshExpireAt = ahora() + 24 * 60 * 60 * 1000;
  }
};

const pedirTokenConPassword = async () => {
  const response = await axios.post(
    TOKEN_URL,
    {
      username: process.env.MATBA_API_USERNAME,
      password: process.env.MATBA_API_PASSWORD,
    },
    {
      timeout: 20_000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  guardarTokens({
    access: response.data?.access,
    refresh: response.data?.refresh,
  });
  return authState.accessToken;
};

const refrescarToken = async () => {
  if (!refreshVigente()) return null;
  const response = await axios.post(
    REFRESH_URL,
    { refresh: authState.refreshToken },
    {
      timeout: 20_000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }
  );
  guardarTokens({
    access: response.data?.access,
  });
  return authState.accessToken;
};

const obtenerAccessToken = async () => {
  bootstrapTokensDesdeEnv();
  if (tokenVigente()) return authState.accessToken;
  try {
    const refreshed = await refrescarToken();
    if (refreshed) return refreshed;
  } catch (_error) {
    // Si falla refresh, intentamos login normal.
  }
  if (!tieneCredenciales()) return authState.accessToken;
  return pedirTokenConPassword();
};

const mapearIndice = (entry, cultivo) => {
  const fechaRaw = entry?.mdEntryDateTime || entry?.updatedAt || new Date().toISOString();
  return {
    cultivo,
    precio_usd: parseNumero(entry?.indexValue),
    vencimiento_dias: parseVencimientoDias(entry?.maturity),
    fecha: toIsoDate(fechaRaw),
    fuente: "matba_rofex",
    mercado: "matba_rofex_futuro",
  };
};

const mapearPosicion = ({ cultivo, posicion }, entry) => {
  const fechaRaw = entry?.mdEntryDateTime || entry?.updatedAt || new Date().toISOString();
  const precio = parseNumero(entry?.last || entry?.price || entry?.indexValue);
  const variacion = parseNumero(entry?.change || entry?.variation);
  const volumen = Number.isFinite(Number(entry?.volume)) ? Number(entry.volume) : null;
  return {
    cultivo,
    posicion,
    precio_usd: precio,
    variacion,
    volumen,
    fecha: toIsoDate(fechaRaw),
    fuente: "matba_rofex",
  };
};

const mapearCultivoDesdeCodigo = (codigo = "") => {
  const c = String(codigo || "").toUpperCase();
  if (c === "SOJ") return "Soja";
  if (c === "MAI") return "Maíz";
  if (c === "TRI") return "Trigo";
  if (c === "GIR") return "Girasol";
  if (c === "SOR") return "Sorgo";
  return null;
};

const normalizarPosicion = (raw = "") => {
  const p = String(raw || "").toUpperCase().replace(/\s+/g, "");
  const m = p.match(/\b(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|SET|OCT|NOV|DIC)(\d{2})\b/);
  if (!m) return null;
  const mes = m[1] === "SET" ? "SEP" : m[1];
  return `${mes}${m[2]}`;
};

const parseTicker = (raw = "") => {
  const t = String(raw || "").toUpperCase().trim();
  const m = t.match(/\b(SOJ|MAI|TRI|GIR|SOR)\.ROS\/([A-Z]{3}\d{2})\b/);
  if (!m) return null;
  const cultivo = mapearCultivoDesdeCodigo(m[1]);
  const posicion = normalizarPosicion(m[2]);
  if (!cultivo || !posicion) return null;
  return { cultivo, posicion, ticker: `${m[1]}.ROS/${posicion}` };
};

const dedupePosiciones = (rows = []) => {
  const seen = new Map();
  for (const r of rows) {
    const key = `${String(r.cultivo || "").toLowerCase()}|${String(r.posicion || "").toUpperCase()}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()];
};

const extraerPosicionesDesdeHtml = (html = "") => {
  const $ = cheerio.load(String(html || ""));
  const out = [];
  const fecha = toIsoDate(new Date().toISOString());

  // Estrategia 1: tablas visibles
  $("table tbody tr").each((_, tr) => {
    const cols = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get()
      .filter(Boolean);
    if (cols.length < 3) return;
    const tickerData = parseTicker(cols[0]) || parseTicker(`${cols[0]}/${cols[1]}`);
    if (!tickerData) return;
    const precio = parseNumeroTexto(cols[2]) || parseNumeroTexto(cols[1]);
    if (!Number.isFinite(precio) || precio <= 0) return;
    out.push({
      cultivo: tickerData.cultivo,
      posicion: tickerData.posicion,
      precio_usd: precio,
      variacion: parseNumeroTexto(cols[3]),
      volumen: null,
      fecha,
      fuente: "matba_rofex_web_scraping",
    });
  });

  // Estrategia 2: regex sobre HTML completo (fallback robusto)
  if (!out.length) {
    const raw = String(html || "");
    const re = /(SOJ|MAI|TRI|GIR|SOR)\.ROS\/([A-Z]{3}\d{2})[\s\S]{0,80}?(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const cultivo = mapearCultivoDesdeCodigo(m[1]);
      const posicion = normalizarPosicion(m[2]);
      const precio = parseNumeroTexto(m[3]);
      if (!cultivo || !posicion || !Number.isFinite(precio) || precio <= 0) continue;
      out.push({
        cultivo,
        posicion,
        precio_usd: precio,
        variacion: null,
        volumen: null,
        fecha,
        fuente: "matba_rofex_web_scraping",
      });
    }
  }

  return dedupePosiciones(out);
};

const obtenerPosicionesDesdeWeb = async () => {
  const response = await axios.get(WEB_AGRO_URL, {
    timeout: 20_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return extraerPosicionesDesdeHtml(response.data);
};

const mapearEspecieAcopiar = (raw = "") => {
  const t = String(raw || "").toLowerCase();
  if (t.includes("soja")) return "Soja";
  if (t.includes("ma")) return "Maíz";
  if (t.includes("trigo")) return "Trigo";
  if (t.includes("girasol")) return "Girasol";
  return null;
};

const normalizarPosicionAcopiar = (raw = "") => {
  const t = String(raw || "").trim();
  const m = t.match(/^(\d{2})\/(20\d{2})$/);
  if (!m) return null;
  const mes = Number(m[1]);
  const anio2 = String(m[2]).slice(-2);
  const map = {
    1: "ENE", 2: "FEB", 3: "MAR", 4: "ABR", 5: "MAY", 6: "JUN",
    7: "JUL", 8: "AGO", 9: "SEP", 10: "OCT", 11: "NOV", 12: "DIC",
  };
  const mm = map[mes];
  if (!mm) return null;
  return `${mm}${anio2}`;
};

const extraerPosicionesDesdeAcopiarHtml = (html = "") => {
  const $ = cheerio.load(String(html || ""));
  const out = [];
  const fecha = toIsoDate(new Date().toISOString());
  let especieActual = null;

  $("table tr").each((_, tr) => {
    const cols = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get()
      .filter((x) => x !== "");
    if (!cols.length) return;
    const primera = cols[0];
    const posibleEspecie = mapearEspecieAcopiar(primera);
    if (posibleEspecie) {
      especieActual = posibleEspecie;
    }
    if (!especieActual) return;

    // Formatos esperados:
    // [Especie, Posición, Ajuste, Variación]
    // [Posición, Ajuste, Variación] (filas siguientes)
    let posRaw = null;
    let ajusteRaw = null;
    let varRaw = null;
    if (posibleEspecie && cols.length >= 3) {
      posRaw = cols[1];
      ajusteRaw = cols[2];
      varRaw = cols[3];
    } else if (!posibleEspecie && cols.length >= 2) {
      posRaw = cols[0];
      ajusteRaw = cols[1];
      varRaw = cols[2];
    }
    const posicion = normalizarPosicionAcopiar(posRaw);
    const precio = parseNumeroTexto(ajusteRaw);
    if (!posicion || !Number.isFinite(precio) || precio <= 0) return;
    out.push({
      cultivo: especieActual,
      posicion,
      precio_usd: precio,
      variacion: parseNumeroTexto(varRaw),
      volumen: null,
      fecha,
      fuente: "acopiarsa_matba_web",
    });
  });

  return dedupePosiciones(out);
};

const obtenerPosicionesDesdeAcopiar = async () => {
  const response = await axios.get(ACOPIAR_MATBA_URL, {
    timeout: 20_000,
    headers: {
      "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  return extraerPosicionesDesdeAcopiarHtml(response.data);
};

const mapearProductoAgrofy = (raw = "") => {
  const t = String(raw || "").toLowerCase();
  if (t.includes("soja")) return "Soja";
  if (t.includes("maiz") || t.includes("maíz")) return "Maíz";
  if (t.includes("trigo")) return "Trigo";
  return null;
};

const normalizarPosicionDesdeMmAaaa = (raw = "") => {
  const t = String(raw || "").trim();
  const m = t.match(/^(\d{2})\/(20\d{2})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const yy = String(m[2]).slice(-2);
  const map = ["", "ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  return map[mm] ? `${map[mm]}${yy}` : null;
};

const extraerPosicionesDesdeAgrofyHtml = (html = "") => {
  const $ = cheerio.load(String(html || ""));
  const out = [];
  const fecha = toIsoDate(new Date().toISOString());

  // Intento estructurado por tabla/grilla.
  $("table tr").each((_, tr) => {
    const cols = $(tr)
      .find("td,th")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    if (cols.length < 3) return;
    const cultivo = mapearProductoAgrofy(cols.join(" ")) || mapearProductoAgrofy(cols[0]);
    const pos =
      normalizarPosicionDesdeMmAaaa(cols.find((c) => /^\d{2}\/20\d{2}$/.test(c)) || "") ||
      normalizarPosicion(cols.find((c) => /^(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\d{2}$/i.test(c)) || "");
    const precio = parseNumeroTexto(cols.find((c) => /-?\d+[.,]\d+|-?\d{2,}/.test(c)) || "");
    if (!cultivo || !pos || !Number.isFinite(precio) || precio <= 0) return;
    out.push({
      cultivo,
      posicion: pos,
      precio_usd: precio,
      variacion: null,
      volumen: null,
      fecha,
      fuente: "agrofy_futuros_web",
    });
  });

  // Fallback textual via regex (sirve con HTML renderizado por proxy lector).
  if (!out.length) {
    const text = $.text().replace(/\s+/g, " ");
    const re =
      /(Soja|Ma[ií]z|Trigo)[^0-9]{0,30}(\d{2}\/20\d{2}|(?:ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SEP|OCT|NOV|DIC)\d{2})[^0-9-]{0,30}(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const cultivo = mapearProductoAgrofy(m[1]);
      const pos = m[2].includes("/") ? normalizarPosicionDesdeMmAaaa(m[2]) : normalizarPosicion(m[2]);
      const precio = parseNumeroTexto(m[3]);
      if (!cultivo || !pos || !Number.isFinite(precio) || precio <= 0) continue;
      out.push({
        cultivo,
        posicion: pos,
        precio_usd: precio,
        variacion: null,
        volumen: null,
        fecha,
        fuente: "agrofy_futuros_web",
      });
    }
  }
  return dedupePosiciones(out);
};

const obtenerPosicionesDesdeAgrofy = async () => {
  const urls = [AGROFY_FUTUROS_URL, `https://r.jina.ai/http://${AGROFY_FUTUROS_URL.replace(/^https?:\/\//, "")}`];
  const all = [];
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        timeout: 25_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (AgroHabilis/1.0)",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      });
      all.push(...extraerPosicionesDesdeAgrofyHtml(response.data));
      if (all.length) break;
    } catch (_error) {
      // Intentamos la siguiente URL.
    }
  }
  return dedupePosiciones(all);
};

const obtenerDatosMATba = async () => {
  const errores = [];
  const indices = [];
  const posiciones = [];

  for (const indice of INDICES) {
    try {
      const data = await obtenerSymbol(indice.symbol);
      indices.push(mapearIndice(data, indice.cultivo));
    } catch (error) {
      errores.push({
        symbol: indice.symbol,
        status: error.response?.status || null,
        message: error.response?.data?.detail || error.message,
      });
    }
  }

  for (const pos of POSICIONES) {
    try {
      const data = await obtenerSymbol(pos.symbol);
      const mapped = mapearPosicion(pos, data);
      if (mapped.precio_usd !== null) {
        posiciones.push(mapped);
      }
    } catch (_error) {
      // Si falla una posicion, seguimos con los indices continuos.
    }
  }

  // Fallback operativo: si no hay posiciones puntuales, usamos los índices
  // como referencia "cercana" para evitar quedar totalmente sin futuros.
  if (!posiciones.length && indices.length) {
    for (const idx of indices) {
      if (!Number.isFinite(Number(idx.precio_usd))) continue;
      posiciones.push({
        cultivo: idx.cultivo,
        posicion: "INDICE_REF",
        precio_usd: Number(idx.precio_usd),
        variacion: null,
        volumen: null,
        fecha: idx.fecha,
        fuente: "matba_rofex_indice_fallback",
      });
    }
  }

  // Fallback adicional: scraping web público si API no devolvió posiciones.
  if (!posiciones.length) {
    try {
      const acopiarRows = await obtenerPosicionesDesdeAcopiar();
      for (const row of acopiarRows) posiciones.push(row);
      if (acopiarRows.length) {
        errores.push({
          symbol: "ACOPIAR_MATBA_FALLBACK",
          status: 200,
          message: `Posiciones obtenidas desde Acopiar: ${acopiarRows.length}`,
        });
      }
    } catch (error) {
      errores.push({
        symbol: "ACOPIAR_MATBA_FALLBACK",
        status: error.response?.status || null,
        message: error.message,
      });
    }
  }

  if (!posiciones.length) {
    try {
      const agrofyRows = await obtenerPosicionesDesdeAgrofy();
      for (const row of agrofyRows) posiciones.push(row);
      if (agrofyRows.length) {
        errores.push({
          symbol: "AGROFY_FUTUROS_FALLBACK",
          status: 200,
          message: `Posiciones obtenidas desde Agrofy: ${agrofyRows.length}`,
        });
      }
    } catch (error) {
      errores.push({
        symbol: "AGROFY_FUTUROS_FALLBACK",
        status: error.response?.status || null,
        message: error.message,
      });
    }
  }

  if (!posiciones.length) {
    try {
      const webRows = await obtenerPosicionesDesdeWeb();
      for (const row of webRows) posiciones.push(row);
      if (webRows.length) {
        errores.push({
          symbol: "WEB_AGRO_FALLBACK",
          status: 200,
          message: `Posiciones obtenidas por scraping web: ${webRows.length}`,
        });
      }
    } catch (error) {
      errores.push({
        symbol: "WEB_AGRO_FALLBACK",
        status: error.response?.status || null,
        message: error.message,
      });
    }
  }

  return {
    indices: indices.filter((x) => x.precio_usd !== null),
    posiciones,
    errores,
  };
};

const obtenerIndicesMATba = async () => {
  const data = await obtenerDatosMATba();
  return data.indices;
};

module.exports = {
  obtenerDatosMATba,
  obtenerIndicesMATba,
};
