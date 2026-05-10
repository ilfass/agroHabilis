const axios = require("axios");
const cheerio = require("cheerio");

const URL = "https://www.argenpapa.com.ar/mercados/";

const parseNumero = (txt = "") => {
  const clean = String(txt).replace(/[^\d.,-]/g, "");
  if (!clean) return null;
  let normalized = clean;
  if (clean.includes(",") && clean.includes(".")) {
    // Formato típico AR: 1.234,56
    normalized = clean.replace(/\./g, "").replace(",", ".");
  } else if (clean.includes(",")) {
    normalized = clean.replace(",", ".");
  } else if (clean.includes(".")) {
    // Si solo hay punto, lo tratamos como decimal cuando aplica (ej 611.11).
    const parts = clean.split(".");
    if (parts.length === 2 && parts[1].length <= 3) {
      normalized = clean;
    } else {
      normalized = clean.replace(/\./g, "");
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const parseFechaActualizacion = (txt = "") => {
  const m = String(txt).match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (!m) return new Date().toISOString().slice(0, 10);
  const meses = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
  };
  const d = Number(m[1]);
  const mes = meses[String(m[2] || "").toLowerCase()] || 1;
  const y = Number(m[3]);
  const iso = new Date(Date.UTC(y, mes - 1, d)).toISOString().slice(0, 10);
  return iso;
};

const nivelIngresoDesdeCamiones = (camiones) => {
  const c = Number(camiones);
  if (!Number.isFinite(c)) return "s/d";
  if (c > 80) return "alto";
  if (c > 50) return "medio";
  return "bajo";
};

const obtenerPreciosPapa = async () => {
  const response = await axios.get(URL, {
    timeout: 30_000,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { "User-Agent": "AgroHabilis/1.0" },
  });
  const $ = cheerio.load(response.data);

  const subtitulo = $(".subtitulo").first().text().trim();
  const fecha = parseFechaActualizacion(subtitulo);
  const out = [];
  const bodyTxt = $("body").text().replace(/\s+/g, " ").trim();
  const mCam = bodyTxt.match(/Total de camiones negociados\s*([0-9\.,]+)/i);
  const mBolsas = bodyTxt.match(/Bolsas en Piso\s*([0-9\.,]+)/i);
  let camionesTotal = parseNumero(mCam?.[1] || "");
  let bolsasPiso = parseNumero(mBolsas?.[1] || "");
  if (!Number.isFinite(camionesTotal) || !Number.isFinite(bolsasPiso)) {
    const ingresoRows = [];
    $("table tr").each((_, tr) => {
      const cols = $(tr)
        .find("td")
        .map((__, td) => $(td).text().trim())
        .get();
      if (cols.length >= 2) ingresoRows.push(cols);
    });
    for (const row of ingresoRows) {
      const key = String(row[0] || "").toLowerCase();
      const val = parseNumero(row[1] || "");
      if (!Number.isFinite(val)) continue;
      if (!Number.isFinite(camionesTotal) && key.includes("total de camiones")) camionesTotal = val;
      if (!Number.isFinite(bolsasPiso) && key.includes("bolsas en piso")) bolsasPiso = val;
    }
  }
  const volumenNivel = nivelIngresoDesdeCamiones(camionesTotal);
  const toneladasEstimadas =
    Number.isFinite(camionesTotal) && Number.isFinite(bolsasPiso) && camionesTotal > 0
      ? Number(((bolsasPiso * 18) / 1000).toFixed(2))
      : Number.isFinite(camionesTotal)
      ? Number((camionesTotal * 27).toFixed(2))
      : null;

  // Fuente principal: tabla "Puestos" con $/Kg Prom (más usable para comparación diaria).
  $("table.puesto tbody tr").each((_, tr) => {
    const cols = $(tr)
      .find("td")
      .map((__, td) => $(td).text().trim())
      .get();
    if (cols.length < 5) return;
    const origen = cols[0] || "Puestos";
    const origenNorm = String(origen).toLowerCase();
    const kgProm = parseNumero(cols[4]);
    const bolsaProm = parseNumero(cols[3]);
    if (Number.isFinite(kgProm)) {
      // Guardamos en ARS por tonelada para mantener consistencia con la tabla precios.
      out.push({
        cultivo: "papa",
        mercado: `MCBA_PUESTOS_${origen}`.replace(/\s+/g, "_").toUpperCase(),
        precio_ars: Number((kgProm * 1000).toFixed(2)),
        precio_usd: null,
        tipo_precio: "referencia",
        calidad: origenNorm.includes("cepillada") ? "primera" : "s/d",
        presentacion: "s/d",
        volumen_ingreso_nivel: volumenNivel,
        volumen_ingreso_fuente: "argenpapa_mcba",
        camiones_total: Number.isFinite(camionesTotal) ? Number(camionesTotal) : null,
        toneladas_estimadas: toneladasEstimadas,
        fecha,
      });
    } else if (Number.isFinite(bolsaProm)) {
      // Aproximación si no hay kg: bolsa típica de 20kg.
      out.push({
        cultivo: "papa",
        mercado: `MCBA_PUESTOS_${origen}`.replace(/\s+/g, "_").toUpperCase(),
        precio_ars: Number(((bolsaProm / 20) * 1000).toFixed(2)),
        precio_usd: null,
        tipo_precio: "referencia",
        calidad: origenNorm.includes("cepillada") ? "primera" : "s/d",
        presentacion: "bolsa_20kg_aprox",
        volumen_ingreso_nivel: volumenNivel,
        volumen_ingreso_fuente: "argenpapa_mcba",
        camiones_total: Number.isFinite(camionesTotal) ? Number(camionesTotal) : null,
        toneladas_estimadas: toneladasEstimadas,
        fecha,
      });
    }
  });

  // Fallback: nave de papa ($/Bolsa Prom) con supuesto 20kg por bolsa.
  if (!out.length) {
    $("table.nave tbody tr").each((_, tr) => {
      const cols = $(tr)
        .find("td")
        .map((__, td) => $(td).text().trim())
        .get();
      if (cols.length < 5) return;
      const origen = cols[0] || "Nave";
      const origenNorm = String(origen).toLowerCase();
      const bolsaProm = parseNumero(cols[4]);
      if (!Number.isFinite(bolsaProm)) return;
      out.push({
        cultivo: "papa",
        mercado: `MCBA_NAVE_${origen}`.replace(/\s+/g, "_").toUpperCase(),
        precio_ars: Number(((bolsaProm / 20) * 1000).toFixed(2)),
        precio_usd: null,
        tipo_precio: "oferta",
        calidad: origenNorm.includes("cepillada") ? "primera" : "s/d",
        presentacion: "bolsa_20kg_aprox",
        volumen_ingreso_nivel: volumenNivel,
        volumen_ingreso_fuente: "argenpapa_mcba",
        camiones_total: Number.isFinite(camionesTotal) ? Number(camionesTotal) : null,
        toneladas_estimadas: toneladasEstimadas,
        fecha,
      });
    });
  }

  const unicos = new Map();
  for (const item of out) {
    const k = `${item.cultivo}_${item.mercado}_${item.fecha}`;
    if (!unicos.has(k)) unicos.set(k, item);
  }
  return Array.from(unicos.values());
};

module.exports = { obtenerPreciosPapa };

