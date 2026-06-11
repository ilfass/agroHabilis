"use strict";

const { detectarCargaMultiLote, particionarPorLotes } = require("../src/services/inventario/nl_heuristica");

const text = '"Registrá un stock inicial de 120 novillos en el lote Potrero Norte" "Declarar stock en el lote Corral 2: tengo 45 vacas y 15 terneros"';

console.log("=== DEBUG MULTI-LOTE ===");
const hits = particionarPorLotes(text);
console.log("particionarPorLotes returned:", JSON.stringify(hits, null, 2));

const multi = detectarCargaMultiLote(text);
console.log("detectarCargaMultiLote returned:", JSON.stringify(multi, null, 2));
