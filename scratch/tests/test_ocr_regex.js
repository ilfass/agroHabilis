"use strict";

const { parsearLotesDeOCR } = require("../src/services/turn_handlers/lotes_plano_handler");

const textDonMartin = `
- Lote 7c: Potrero 20.24 | Agrícola 0.00
- Lote 7d: Potrero 19.26 | Agrícola 18.94
- Lote 8: Potrero 40.81 | Agrícola 40.04
`;

const textSolNaciente = `
Tabla de Superficies:
- Lote 1: Sup. Potrero = 46.28 ha | Sup. Agrícola = 45.33 ha
- Lote 2: Sup. Potrero = 29.60 ha | Sup. Agrícola = 29.25 ha
- Lote 3: Sup. Potrero = 29.48 ha | Sup. Agrícola = 29.17 ha
`;

console.log("=== Testing Don Martín ===");
console.log(parsearLotesDeOCR(textDonMartin));

console.log("\n=== Testing El Sol Naciente ===");
console.log(parsearLotesDeOCR(textSolNaciente));
