"use strict";

const { parsearJSON } = require("../src/services/clasificador");

function runTest(text, expectedIntent) {
  console.log(`\nTesting: ${JSON.stringify(text)}`);
  try {
    const obj = parsearJSON(text);
    console.log(`Result: SUCCESS -> intencion: "${obj.intencion}", cultivo: ${obj.cultivo}`);
    if (obj.intencion === expectedIntent) {
      console.log("✅ MATCHED EXPECTED");
    } else {
      console.log(`❌ MISMATCH: expected "${expectedIntent}", got "${obj.intencion}"`);
    }
  } catch (err) {
    console.log(`Result: FAILED -> ${err.message}`);
    if (expectedIntent === null) {
      console.log("✅ EXPECTED FAILURE");
    } else {
      console.log("❌ UNEXPECTED FAILURE");
    }
  }
}

// 1. Standard valid JSON
runTest(`{"intencion": "precio", "cultivo": "soja"}`, "precio");

// 2. JSON with leading/trailing text
runTest(`Here is the classification:\n{\n  "intencion": "clima",\n  "cultivo": null\n}\nHope this helps!`, "clima");

// 3. Invalid JSON but contains key-value pair
runTest(`Here is the classification:\n"intencion": "registrar"\ncultivo: "maiz"`, "registrar");

// 4. Invalid JSON but contains the word of intent
runTest(`The intention should be fletes because the user is asking about transportation costs.`, "fletes");

// 5. Completely invalid garbage
runTest(`Here is the classification for your query`, null);
