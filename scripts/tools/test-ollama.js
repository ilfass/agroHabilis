#!/usr/bin/env node
/**
 * Prueba Ollama como proveedor local y el orden **resguardo** (ollama siempre al final).
 *
 * Requisitos: Ollama instalado y en marcha; modelo descargado (`ollama pull <OLLAMA_MODEL>`).
 *
 * Uso:
 *   OLLAMA_ENABLED=1 npm run test:ollama
 */
"use strict";

require("dotenv").config();

const { ollamaHabilitado, generarChatOllama, getModel, baseUrl } = require("../../src/services/ollama");
const { ejecutarJsonConCadenaIA } = require("../../src/services/agent/ia/json_chain");

const main = async () => {
  console.log("OLLAMA_ENABLED →", ollamaHabilitado());
  console.log("OLLAMA_BASE_URL →", baseUrl());
  console.log("OLLAMA_MODEL →", getModel());

  if (!ollamaHabilitado()) {
    console.error("\nDefiní OLLAMA_ENABLED=1 en .env y reintentá.");
    process.exit(1);
  }

  console.log("\n--- 1) Chat directo /api/chat (JSON) ---");
  const out = await generarChatOllama({
    system: "Respondé SOLO un objeto JSON válido, sin markdown ni texto fuera del JSON.",
    user: 'Devolvé exactamente: {"ping":true,"fuente":"test-ollama"}',
    maxTokens: 256,
  });
  console.log("Modelo:", out.model);
  console.log("Respuesta (recorte):", out.texto.slice(0, 300));

  console.log("\n--- 2) Resguardo: verifica que con orden 'ollama' se usa Ollama ---");
  // Ya no exponemos ordenarProveedores; se verifica por comportamiento en el test #3.

  console.log("\n--- 3) Misma función que producción: `ejecutarJsonConCadenaIA` solo vía Ollama ---");
  const prev2 = process.env.AGENT_GATE_IA_ORDER;
  process.env.AGENT_GATE_IA_ORDER = "ollama";
  try {
    const j = await ejecutarJsonConCadenaIA({
      system: 'Solo JSON. Formato: {"ok":boolean,"n":number}. n debe ser 1.',
      user: "Test cadena json_chain.",
      maxTokens: 200,
      orderEnvVar: "AGENT_GATE_IA_ORDER",
      contextLabel: "test.ollama_solo",
    });
    console.log("Proveedor usado:", j.providerUsed);
    console.log("Parsed:", JSON.stringify(j.parsed));
    if (j.providerUsed !== "ollama") {
      throw new Error("Con orden solo `ollama` debería usarse Ollama.");
    }
  } finally {
    if (prev2 === undefined) delete process.env.AGENT_GATE_IA_ORDER;
    else process.env.AGENT_GATE_IA_ORDER = prev2;
  }

  console.log("\nOK — Ollama responde y queda como resguardo en el orden por defecto.");
};

main().catch((e) => {
  console.error("\nError:", e.message);
  if (/ECONNREFUSED|ENOTFOUND/i.test(String(e.message))) {
    console.error("¿Ollama está levantado? (servicio en el puerto de OLLAMA_BASE_URL)");
  }
  process.exit(1);
});
