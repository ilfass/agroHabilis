const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const axios = require("axios");

const execFileAsync = promisify(execFile);

const BOLETIN_LIST_URL =
  "https://www.bcr.com.ar/es/mercados/boletin-diario/mercado-de-granos";
const PDF_BASE_URL = "https://www.bcr.com.ar/sites/default/files/";

const USER_AGENT =
  "Mozilla/5.0 (compatible; AgroHabilis/1.0; +https://agro.habilispro.com)";

const PRODUCTOS = new Set([
  "Trigo",
  "Maíz",
  "Maiz",
  "Cebada",
  "Sorgo",
  "Soja",
  "Girasol",
]);

const normalizeNumeroArg = (raw) => {
  const s = String(raw).trim();
  if (!s || s.toUpperCase() === "S/C") return null;
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

const extraerUltimoNumeroBoletin = (html) => {
  const matches = [...html.matchAll(/boletin-mercado-granos-(\d+)\.pdf/gi)];
  if (!matches.length) {
    throw new Error("No se encontraron enlaces a PDF del boletin en la pagina");
  }
  return matches.reduce((max, m) => Math.max(max, Number(m[1])), 0);
};

const descargarPdf = async (numeroBoletin) => {
  const url = `${PDF_BASE_URL}boletin-mercado-granos-${numeroBoletin}.pdf`;
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": USER_AGENT },
    timeout: 60_000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  });
  return { url, buffer: Buffer.from(response.data) };
};

const pdfABufferATexto = async (pdfBuffer) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "agrohabilis-bcr-"));
  const pdfPath = path.join(tmpDir, "boletin.pdf");
  const txtPath = path.join(tmpDir, "boletin.txt");
  await fs.writeFile(pdfPath, pdfBuffer);

  try {
    await execFileAsync("pdftotext", ["-layout", pdfPath, txtPath], {
      timeout: 60_000,
    });
    return await fs.readFile(txtPath, "utf8");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};

const parsearMercadoFisicoRosario = (texto) => {
  const lineas = texto.split(/\r?\n/);

  let idxSeccion = -1;
  for (let i = 0; i < lineas.length; i += 1) {
    if (
      lineas[i].includes("Precios del Mercado de Físico de Granos de Rosario")
    ) {
      idxSeccion = i;
      break;
    }
  }
  if (idxSeccion === -1) {
    throw new Error(
      "No se encontro la seccion 'Precios del Mercado de Fisico de Granos de Rosario' en el PDF"
    );
  }

  const fechaMatch = lineas[idxSeccion].match(/(\d{2}\/\d{2}\/\d{4})/);
  if (!fechaMatch) {
    throw new Error("No se pudo inferir la fecha de la seccion de Rosario");
  }
  const [, fechaDdMmYyyy] = fechaMatch;

  const filas = [];
  let productoActual = null;

  for (let i = idxSeccion + 1; i < lineas.length; i += 1) {
    const linea = lineas[i];
    if (linea.includes("Boletín Diario") && filas.length > 0) break;
    if (linea.includes("ROFEX:")) break;

    const candidatoProducto = linea.trim();
    if (PRODUCTOS.has(candidatoProducto)) {
      productoActual =
        candidatoProducto === "Maiz" ? "Maíz" : candidatoProducto;
      continue;
    }

    if (!productoActual) continue;
    if (!linea.startsWith(" ")) continue;

    const parsearLineaCotizacion = (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) return null;

      if (/\bS\/C\s*$/i.test(trimmed)) return null;

      const montoRe =
        /(u\$s\s+)?((?:\d{1,3}(?:\.\d{3})+,\d{2})|(?:\d{1,3}(?:\.\d{3})*,\d{2})|(?:\d+,\d{2})|(?:\d+))\s*$/i;
      const match = trimmed.match(montoRe);
      if (!match) return null;

      const esUsd = Boolean(match[1]);
      const precio = normalizeNumeroArg(match[2]);
      if (precio === null) return null;

      const izquierda = trimmed.slice(0, match.index).trim();
      const columnas = izquierda
        .split(/\s{2,}/g)
        .map((p) => p.trim())
        .filter(Boolean);

      if (!columnas.length) return null;

      const destino = columnas[0] || "";
      const entrega = columnas[1] || "";
      const calidad = columnas.slice(2).join(" | ") || "";

      return {
        destino,
        entrega,
        calidad,
        precio,
        moneda: esUsd ? "USD" : "ARS",
      };
    };

    const parsed = parsearLineaCotizacion(linea);
    if (!parsed) continue;

    const { destino, entrega, calidad, precio, moneda } = parsed;

    filas.push({
      cultivo: productoActual,
      destino,
      entrega,
      calidad,
      precio,
      moneda,
    });
  }

  if (!filas.length) {
    throw new Error("La seccion de Rosario no produjo filas parseables");
  }

  return { fechaTexto: fechaDdMmYyyy, filas };
};

const agregarPorGrupo = (mapa, fila) => {
  const key = `${fila.cultivo}|${fila.moneda}`;
  const prev = mapa.get(key);
  if (!prev || fila.precio < prev.precio) mapa.set(key, fila);
};

const esEntregaDisponible = (entrega) => {
  const e = String(entrega || "").toLowerCase();
  if (!e) return false;
  if (e.includes("c/desc")) return true;
  if (e.includes("c/ desc")) return true;
  if (e.includes("e/ctc")) return true;
  if (e.includes("e/ ctc")) return true;
  if (e.includes("inmediata")) return true;
  return false;
};

const resumirFilas = (filas) => {
  const preferidas = filas.filter((f) => esEntregaDisponible(f.entrega));
  const base = preferidas.length ? preferidas : filas;

  const minimos = new Map();
  for (const fila of base) agregarPorGrupo(minimos, fila);
  return [...minimos.values()].sort((a, b) => {
    if (a.cultivo !== b.cultivo) return a.cultivo.localeCompare(b.cultivo);
    return a.moneda.localeCompare(b.moneda);
  });
};

const obtenerDatosUltimoBoletin = async () => {
  const listHtmlResp = await axios.get(BOLETIN_LIST_URL, {
    headers: { "User-Agent": USER_AGENT },
    timeout: 60_000,
    maxRedirects: 5,
    validateStatus: (s) => s === 200,
  });

  const numero = extraerUltimoNumeroBoletin(String(listHtmlResp.data));
  const { url, buffer } = await descargarPdf(numero);
  const texto = await pdfABufferATexto(buffer);
  const { fechaTexto, filas } = parsearMercadoFisicoRosario(texto);

  return {
    boletinNumero: numero,
    pdfUrl: url,
    fechaMercadoTexto: fechaTexto,
    filas,
    minimos: resumirFilas(filas),
  };
};

module.exports = {
  obtenerDatosUltimoBoletin,
};
