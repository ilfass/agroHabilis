"use strict";
const { parseRegistroGanadoMultipleHeuristic } = require("../src/services/inventario/nl_heuristica");

const text = "tengo 10 vacas en el lote 5 y 2 toros";
console.log("Input:", text);
console.log("Result:", JSON.stringify(parseRegistroGanadoMultipleHeuristic(text), null, 2));
