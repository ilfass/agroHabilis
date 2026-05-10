const axios = require("axios");

const URL =
  "https://datos.magyp.gob.ar/dataset/8b4d6a1f-753d-4707-9085-bdcbbc47f00b/resource/6dce1e87-7988-4eaf-b0e1-b3abbb3964da/download/precios-fyh-mercadocentral-bsas-arg-2017-2c2018-.csv";

const MESES = {
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

const norm = (v = "") =>
  String(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const splitCsvLine = (line = "") => {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        q = !q;
      }
      continue;
    }
    if (ch === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
};

const toDate = ({ anio, mes }) => {
  const y = Number(anio);
  const m = MESES[norm(mes)] || 1;
  if (!Number.isFinite(y) || y < 1900) return null;
  return new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
};

const obtenerPreciosPapaMagyp = async () => {
  const response = await axios.get(URL, {
    timeout: 30_000,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: { "User-Agent": "AgroHabilis/1.0" },
  });
  const raw = String(response.data || "");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map(norm);
  const idxAnio = (() => {
    const direct = header.indexOf("año") >= 0 ? header.indexOf("año") : header.indexOf("ano");
    if (direct >= 0) return direct;
    return header.findIndex((h) => /^a.?o$/.test(String(h || "")));
  })();
  const idx = {
    mercado: header.indexOf("mercado"),
    anio: idxAnio,
    mes: header.indexOf("mes"),
    producto: header.indexOf("producto"),
    precio: header.indexOf("precio_usd_kg"),
  };
  if (Object.values(idx).some((v) => v < 0)) return [];

  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const mercado = cols[idx.mercado];
    const producto = cols[idx.producto];
    if (!norm(producto).includes("papa")) continue;
    if (!norm(mercado).includes("mercado central")) continue;
    const precioUsdKg = Number(String(cols[idx.precio] || "").replace(",", "."));
    if (!Number.isFinite(precioUsdKg) || precioUsdKg <= 0) continue;
    const fecha = toDate({ anio: cols[idx.anio], mes: cols[idx.mes] });
    if (!fecha) continue;
    rows.push({
      cultivo: "papa",
      mercado: "MCBA_MAGYP_CSV",
      precio_ars: null,
      precio_usd: Number((precioUsdKg * 1000).toFixed(4)),
      tipo_precio: "referencia",
      calidad: "s/d",
      presentacion: "s/d",
      volumen_ingreso_nivel: "s/d",
      volumen_ingreso_fuente: "magyp_csv",
      fecha,
    });
  }
  if (!rows.length) return [];
  rows.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return [rows[0]];
};

module.exports = { obtenerPreciosPapaMagyp };

