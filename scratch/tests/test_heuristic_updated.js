"use strict";

const RE_EXCLUIR_DESCRIPCION = /^(y|e|o|u|a|ante|bajo|cabe|con|contra|de|desde|durante|en|entre|hacia|hasta|mediante|para|por|segun|sin|so|sobre|tras|versus|via|el|la|los|las|un|una|unos|unas|mi|mis|tu|tus|su|sus|este|esta|ese|esa|aquel|aquella|lote|lotes|campo|campos|has|ha|hectarea|hectareas|tn|tonelada|toneladas|kilos|kg|litros|ltrs)$/i;

function parseRegistroGanadoMultipleHeuristicTest(textoOriginal = "") {
  const norm = (s = "") =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const normalizarNumeralesAntesDeGanado = (texto = "") => {
    const raw = String(texto || "");
    if (!raw) return raw;
    const ANIMAL_TOKEN_RE = /^(vacas?|vaquillonas?|novillos?|novillitos?|terneros?|terneras?|toros?|cabezas?|cabs?|cabras?|chivos?|ovejas?|corderos?|caballos?|yeguas?|cerdos?|chanchos?|lechones?)$/i;
    const NUM_PALABRAS_HASTA_VEINTE = {
      un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
      once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20
    };
    return raw.replace(/\b([a-záéíóúñ]+)(\s+)(?=([a-záéíóúñ]+)\b)/gi, (match, p1, sep, p2) => {
      const key = norm(p1);
      const num = NUM_PALABRAS_HASTA_VEINTE[key];
      if (num != null && ANIMAL_TOKEN_RE.test(p2)) {
        return `${num}${sep}`;
      }
      return match;
    });
  };

  const inferirEspecieDesdeEtiqueta = (cat = "") => {
    const c = cat.toLowerCase();
    if (/vaca|novillo|terner|toro|vaquillon|cabeza|cab\b/i.test(c)) return "vacuno";
    if (/oveja|cordero|borrego|carnero/i.test(c)) return "ovino";
    if (/cabra|chivo|cabrito/i.test(c)) return "caprino";
    if (/cerdo|chancho|lechon|porcino/i.test(c)) return "porcino";
    if (/caballo|yegua|potrillo|equino/i.test(c)) return "equino";
    return "vacuno";
  };

  const normalizarCategoriaGanadoCategoria = (base = "", extra = "") => {
    const b = String(base || "").trim().toLowerCase();
    const e = String(extra || "").trim().toLowerCase();
    if (!b && !e) return "";
    if (!e) return b;
    if (/^(y|e|o|u|en|del|de|al|con|para|por|los|las|el|la|un|una)$/i.test(e)) return b;
    return `${b} ${e}`.replace(/\s+/g, " ").trim();
  };

  const sNorm = normalizarNumeralesAntesDeGanado(String(textoOriginal || ""));
  const s = sNorm.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (!/\by\b/i.test(s) && !/[,;]/.test(s)) return null;
  if (!/\b(vaca|novillo|ternero|toro|vaquillona|cabeza|cab|oveja|cordero|cabra|chivo|cerdo|chancho|lechon|caballo|yegua)\w*\b/i.test(s))
    return null;

  const tNorm = norm(s);
  const esPrecioGanado =
    /\b(cuanto|cuantos|cuanto\s+salen|cuanto\s+valen|cuanto\s+cuesta|precio\s+de|valor\s+de|cotizacion|liniers|rosario|cac\b|remate|hacienda\s+en\s+pie)\b/.test(tNorm);
  if (esPrecioGanado) return null;
  const esBajaOPerdida =
    /\b(perdi|murio|murieron|fallecio|fallecieron|se\s+murieron?|vendi|sali[oo]|salieron|egres[ao]|retir[eé]|retiraron)\b/.test(tNorm);
  if (esBajaOPerdida) return null;

  const re = /(?:^|[\s,;]|y\s+)(\d+[.,]?\d*)\s+([a-záéíóúñ]+)(?:\s+([a-záéíóúñ]+))?/gi;
  let m;
  const items = [];
  let ultimaBaseAnimal = "";

  while ((m = re.exec(s))) {
    const cantidad = Number(String(m[1]).replace(",", "."));
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    const w1 = String(m[2] || "").toLowerCase();
    const w2 = String(m[3] || "").toLowerCase();
    if (!w1) continue;

    const esAnimal = /(vaca|novillo|ternero|toro|vaquillona|cabeza|cab|oveja|cordero|cabra|chivo|cerdo|chancho|lechon|caballo|yegua)\w*/i.test(w1);
    
    // Si no es animal y está en la lista de exclusión (conjunción, preposición, etc.), ignoramos por completo
    if (!esAnimal && RE_EXCLUIR_DESCRIPCION.test(w1)) {
      continue;
    }

    let categoria = "";
    if (esAnimal) {
      ultimaBaseAnimal = w1;
      categoria = normalizarCategoriaGanadoCategoria(w1, w2);
    } else if (ultimaBaseAnimal) {
      categoria = normalizarCategoriaGanadoCategoria(ultimaBaseAnimal, w1);
    } else {
      continue;
    }

    const especie = inferirEspecieDesdeEtiqueta(categoria);
    items.push({
      especie,
      categoria,
      cantidad: Math.round(cantidad),
    });
  }

  if (items.length < 2) return null;
  return {
    tipo: "registro_multiple",
    dominio: "ganado",
    efecto: "replace",
    payload: { items },
  };
}

// Pruebas
const test1 = "tengo 10 vacas en el lote 5 y 2 toros";
console.log("Input:", test1);
console.log("Result:", JSON.stringify(parseRegistroGanadoMultipleHeuristicTest(test1), null, 2));

const test2 = "10 vacas y 5 preñadas";
console.log("Input:", test2);
console.log("Result:", JSON.stringify(parseRegistroGanadoMultipleHeuristicTest(test2), null, 2));

const test3 = "Registrar 10 toros 13 vacas y 150 ovejas";
console.log("Input:", test3);
console.log("Result:", JSON.stringify(parseRegistroGanadoMultipleHeuristicTest(test3), null, 2));
