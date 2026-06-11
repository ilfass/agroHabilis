const axios = require("axios");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

async function testGroq(apiKey) {
  console.log("\n==> Testing Groq with llama-3.1-8b-instant...");
  try {
    const { data } = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: "Hello! Respond with OK" }]
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );
    const text = data?.choices?.[0]?.message?.content?.trim();
    console.log(`[SUCCESS] Groq Response: "${text}"`);
    return true;
  } catch (error) {
    console.error("[FAILURE] Groq call failed:", error.response?.data || error.message);
    return false;
  }
}

async function testOpenRouter(apiKey) {
  console.log("\n==> Testing OpenRouter with openrouter/free...");
  try {
    const { data } = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "google/gemma-2-9b-it:free",
        messages: [{ role: "user", content: "Hello! Respond with OK" }]
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );
    const text = data?.choices?.[0]?.message?.content?.trim();
    console.log(`[SUCCESS] OpenRouter Response: "${text}"`);
    return true;
  } catch (error) {
    console.error("[FAILURE] OpenRouter call failed:", error.response?.data || error.message);
    return false;
  }
}

async function run() {
  console.log("==> Loading VPS env...");
  const envPath = path.join(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    console.error("Error: no .env file found!");
    process.exit(1);
  }
  dotenv.config({ path: envPath });

  const groqKey = process.env.GROQ_API_KEY?.trim();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();

  let groqOk = false;
  let orOk = false;

  if (groqKey) {
    groqOk = await testGroq(groqKey);
  } else {
    console.warn("Groq key is not configured.");
  }

  if (openRouterKey) {
    orOk = await testOpenRouter(openRouterKey);
  } else {
    console.warn("OpenRouter key is not configured.");
  }

  console.log("\n=== DIAGNOSTIC SUMMARY ===");
  console.log(`Groq Operational: ${groqOk ? "YES (Fully Operational) ✅" : "NO ❌"}`);
  console.log(`OpenRouter Operational: ${orOk ? "YES (Fully Operational) ✅" : "NO ❌"}`);
}

run().catch(console.error);
