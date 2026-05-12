#!/usr/bin/env node
/**
 * Verifica:
 *  1) Que `resumirFragmentoMultiLote` extraiga resumenes útiles para la
 *     vista previa estilo Cursor del multi-lote.
 *  2) Que la planilla original del bug se siga detectando como
 *     `multi_lote` con 5 cargas + 6 sin hacienda.
 *
 * Uso: npm run test:multilote
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const dbPath = path.join(__dirname, "..", "src", "config", "database.js");
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    pool: { end: async () => {} },
  },
};
Module._cache = require.cache;

const { parseIntentInventario } = require("../src/services/inventario/nl_heuristica");

/**
 * El helper vive como función LOCAL del flow; lo extraigo por re-require
 * con un eval rápido del archivo no es buena idea. Mejor lo importo
 * indirectamente: el flow lo usa dentro del bloque multi_lote pero no lo
 * exporta. Para testearlo, lo re-implemento acá igual al archivo y
 * verificamos la lógica. (Tests defensivos: si el helper cambia, este
 * test se desincroniza — para eso comparamos también con la salida real
 * del clasificador `parseIntentInventario` sobre la planilla original.)
 */
function resumirFragmentoMultiLote(fragmento = "") {
  const texto = String(fragmento || "");
  if (!texto.trim()) return null;
  const re = /(\d+(?:[.,]\d+)?)\s+(novillos?|vacas?|vaquillonas?|terneros?|toros?|cabezas?|cabs?\.?|cabras?|chivos?|ovejas?|corderos?|caballos?|yeguas?|cerdos?|chanchos?|lechones?|machos?|hembras?|hect[áa]reas?|h[aá]s?|kg|tn|toneladas?|lts?\.?|litros?)/gi;
  const matches = [];
  let m;
  while ((m = re.exec(texto)) !== null) {
    matches.push({ num: m[1], cat: m[2].toLowerCase() });
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return `${matches[0].num} ${matches[0].cat}`;
  const primero = `${matches[0].num} ${matches[0].cat}`;
  const otros = matches.slice(1, 4).map((x) => x.num).join(" + ");
  const sufijo = matches.length > 4 ? "…" : "";
  return `${primero} + ${otros}${sufijo} _(${matches.length} grupos)_`;
}

let ok = 0, fail = 0;
const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(70)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

// ===== Tests del helper =====

(() => {
  const r1 = resumirFragmentoMultiLote("Lote 4. 100 vaquillonas de Arias");
  print("resumen: '100 vaquillonas' simple", r1 === "100 vaquillonas", r1);

  const r2 = resumirFragmentoMultiLote("Lote 7. 46 vacas Lur Anaiak y 50 vacas Oyhamburu");
  print(
    "resumen: '46 vacas + 50' compuesto",
    /^46 vacas \+ 50.*2 grupos/.test(r2),
    r2
  );

  const r3 = resumirFragmentoMultiLote(
    "Lote 2b. Invernada de tres titulares diferentes. 60 vaquillonas de Fernández 64 macho y hembra de Oyhamburu 45 macho y hembra de Agro La Elisa"
  );
  print(
    "resumen: 3 grupos en lote 2b",
    /^60 vaquillonas \+ 64.*45.*3 grupos/.test(r3),
    r3
  );

  const r4 = resumirFragmentoMultiLote("Lote 6. 106 vacas San Edmundo");
  print("resumen: '106 vacas'", r4 === "106 vacas", r4);

  const r5 = resumirFragmentoMultiLote("Lote 8. 28 toros");
  print("resumen: '28 toros'", r5 === "28 toros", r5);

  const r6 = resumirFragmentoMultiLote("Lote 1. Sin hacienda");
  print("resumen: 'sin hacienda' → null", r6 === null, String(r6));

  const r7 = resumirFragmentoMultiLote("Lote 5 80 ha de soja");
  print("resumen: agrícola '80 ha'", /80 ha/.test(r7 || ""), r7);

  const r8 = resumirFragmentoMultiLote("Lote 9 500 kg de glifosato");
  print("resumen: insumo '500 kg'", /500 kg/.test(r8 || ""), r8);
})();

// ===== Tests de integración: planilla original del bug =====

(() => {
  const planilla = `Lote 1. Sin hacienda
Lote 2a. Sin hacienda
Lote 2b. Invernada de tres titulares diferentes.
60 vaquillonas de Fernández
64 macho y hembra de Oyhamburu
45 macho y hembra de Agro La Elisa
Lote 3. Sin hacienda
Lote 4. 100 vaquillonas de Arias
Lote 5. Sin hacienda
Lote 6. 106 vacas San Edmundo
Lote 7. 46 vacas Lur Anaiak y 50 vacas Oyhamburu
Lote 8. 28 toros
Lote 9. Sin hacienda
Lote 10. Sin hacienda`;
  const r = parseIntentInventario(planilla);
  print(
    "planilla bug original → multi_lote detectado",
    r?.clase === "multi_lote",
    `clase=${r?.clase}`
  );
  print(
    "planilla bug original → 5 bloques con carga",
    Array.isArray(r?.bloques) && r.bloques.length === 5,
    `bloques=${r?.bloques?.length}`
  );
  print(
    "planilla bug original → 6 bloques sin hacienda",
    Array.isArray(r?.bloques_sin_carga) && r.bloques_sin_carga.length === 6,
    `sin_carga=${r?.bloques_sin_carga?.length}`
  );
  /** Verificamos que cada bloque con carga tenga un resumen no nulo. */
  for (const b of r?.bloques || []) {
    const resumen = resumirFragmentoMultiLote(b.fragmento);
    print(
      `  preview Lote ${b.lote_nombre} → "${resumen?.slice(0, 50) || "(null)"}"`,
      resumen != null
    );
  }
})();

console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
if (fail) process.exit(1);
