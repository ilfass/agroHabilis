const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Load environmental variables
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const { keysPool } = require("../src/services/gemini_keys");
const { generarTextoConReintentos } = require("../src/services/gemini");
const { generarChatGroq } = require("../src/services/groq");
const { generarChatOpenRouter } = require("../src/services/openrouter");
const { generarChatOllama, getModel, ollamaHabilitado } = require("../src/services/ollama");

async function testGeminiKey(key, index) {
  const original = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = key;
  const start = Date.now();
  try {
    const res = await generarTextoConReintentos("hello, respond with exactly 'OK'", "test.gemini", {
      maxOutputTokens: 1000,
      temperature: 0,
    });
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    const text = String(res.texto || "").trim().toUpperCase();
    const isOk = text.includes("OK") || text.includes("PONG");
    return {
      provider: `Gemini Key ${index + 1}`,
      credential: `...${key.slice(-6)}`,
      status: isOk ? "OPERATIVE ✅" : `BAD RESPONSE (got: "${res.texto}") ❌`,
      latency: `${latency}s`,
    };
  } catch (err) {
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    return {
      provider: `Gemini Key ${index + 1}`,
      credential: `...${key.slice(-6)}`,
      status: `FAILED (error: ${err.message}) ❌`,
      latency: `${latency}s`,
    };
  } finally {
    process.env.GEMINI_API_KEY = original;
  }
}

async function testGroq() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    return { provider: "Groq", credential: "not_configured", status: "DISABLED ⚪", latency: "N/A" };
  }
  const start = Date.now();
  try {
    const res = await generarChatGroq({
      system: "Respond exactly with OK",
      user: "ping",
      maxTokens: 1000,
      temperature: 0,
    });
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    const text = String(res.texto || "").trim().toUpperCase();
    const isOk = text.includes("OK") || text.includes("PONG");
    return {
      provider: `Groq (${res.model})`,
      credential: `...${key.slice(-6)}`,
      status: isOk ? "OPERATIVE ✅" : `BAD RESPONSE (got: "${res.texto}") ❌`,
      latency: `${latency}s`,
    };
  } catch (err) {
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    return {
      provider: "Groq",
      credential: `...${key.slice(-6)}`,
      status: `FAILED (error: ${err.message}) ❌`,
      latency: `${latency}s`,
    };
  }
}

async function testOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    return { provider: "OpenRouter", credential: "not_configured", status: "DISABLED ⚪", latency: "N/A" };
  }
  const start = Date.now();
  try {
    const res = await generarChatOpenRouter({
      system: "Respond exactly with OK",
      user: "ping",
      maxTokens: 1000,
      temperature: 0,
    });
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    const text = String(res.texto || "").trim().toUpperCase();
    const isOk = text.includes("OK") || text.includes("PONG");
    return {
      provider: `OpenRouter (${res.model})`,
      credential: `...${key.slice(-6)}`,
      status: isOk ? "OPERATIVE ✅" : `BAD RESPONSE (got: "${res.texto}") ❌`,
      latency: `${latency}s`,
    };
  } catch (err) {
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    return {
      provider: "OpenRouter",
      credential: `...${key.slice(-6)}`,
      status: `FAILED (error: ${err.message}) ❌`,
      latency: `${latency}s`,
    };
  }
}

async function testOllama() {
  if (!ollamaHabilitado()) {
    return { provider: "Ollama", credential: "local", status: "DISABLED ⚪", latency: "N/A" };
  }
  const start = Date.now();
  try {
    const res = await generarChatOllama({
      system: "Respond exactly with OK",
      user: "ping",
      maxTokens: 1000,
      temperature: 0,
    });
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    const text = String(res.texto || "").trim().toUpperCase();
    const isOk = text.includes("OK") || text.includes("PONG");
    return {
      provider: `Ollama (${res.model})`,
      credential: "local",
      status: isOk ? "OPERATIVE ✅" : `BAD RESPONSE (got: "${res.texto}") ❌`,
      latency: `${latency}s`,
    };
  } catch (err) {
    const latency = ((Date.now() - start) / 1000).toFixed(2);
    return {
      provider: `Ollama (${getModel()})`,
      credential: "local",
      status: `FAILED (error: ${err.message}) ❌`,
      latency: `${latency}s`,
    };
  }
}

async function main() {
  console.log("=== STARTING FULL AI DIAGNOSTIC SUITE ===\n");

  const results = [];

  // 1. Test Gemini keys
  console.log(`Checking ${keysPool.length} Gemini keys...`);
  for (let i = 0; i < keysPool.length; i++) {
    const keyResult = await testGeminiKey(keysPool[i], i);
    results.push(keyResult);
  }

  // 2. Test Groq
  console.log("Checking Groq...");
  const groqResult = await testGroq();
  results.push(groqResult);

  // 3. Test OpenRouter
  console.log("Checking OpenRouter...");
  const orResult = await testOpenRouter();
  results.push(orResult);

  // 4. Test Ollama
  console.log("Checking Ollama local...");
  const ollamaResult = await testOllama();
  results.push(ollamaResult);

  // Print results in a neat console table
  console.log("\n=== AI PROVIDERS STATUS REPORT ===\n");
  console.table(results);
}

main().catch(console.error);
