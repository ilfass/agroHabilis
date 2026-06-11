"use strict";

const { inferirComandoNatural } = require("../src/services/intent_classifier");

const cases = [
  { input: "Si, pasame rapido que puedo hacer. Me interesa sobre todo precios, alertas climaticas y margenes por cultivo.", expected: null },
  { input: "Eh? Yo no te pedi una alerta todavia. Te pregunte que cosas podes hacer nomas.", expected: null },
  { input: "quiero que me avises si la soja supera 440k", expected: "__ALERTA__" },
  { input: "avisame si la soja baja de 400", expected: "__ALERTA__" },
  { input: "alertame cuando trigo suba a 200", expected: "__ALERTA__" },
  { input: "crear alerta soja 450", expected: "__ALERTA__" },
  { input: "que alertas tengo activas", expected: "MIS ALERTAS" }
];

console.log("=== RUNNING INTENT CLASSIFIER ALERT TEST ===");
let ok = 0;
for (const c of cases) {
  const result = inferirComandoNatural(c.input);
  const pass = result === c.expected;
  if (pass) ok++;
  console.log(`${pass ? "✓" : "✗"} Input: "${c.input}" -> Got: ${result} (Expected: ${c.expected})`);
}
console.log(`\nResult: ${ok}/${cases.length} passed.`);
if (ok !== cases.length) {
  process.exit(1);
}
