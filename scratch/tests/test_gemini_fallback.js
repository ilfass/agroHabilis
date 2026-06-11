const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

async function run() {
  console.log("==> Loading VPS env...");
  const envPath = path.join(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    console.error("Error: no .env file found!");
    process.exit(1);
  }
  dotenv.config({ path: envPath });

  const fallbackKey = process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if (!fallbackKey) {
    console.error("Error: GEMINI_API_KEY_FALLBACK is not configured in .env!");
    process.exit(1);
  }

  console.log(`==> Found fallback key (ends with: ...${fallbackKey.slice(-6)})`);
  console.log("==> Initializing GoogleGenerativeAI with paid/fallback key...");
  
  const genAI = new GoogleGenerativeAI(fallbackKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  console.log("==> Sending simple diagnostic prompt: 'Hello! Respond with OK'...");
  try {
    const result = await model.generateContent("Hello! Respond with OK");
    const response = result.response;
    const text = response.text().trim();
    console.log(`\n[SUCCESS] Response from Gemini: "${text}"`);
    console.log("Paid key is 100% operational and working perfectly! ✅");
  } catch (error) {
    console.error("\n[FAILURE] Failed to call Gemini with fallback key:", error.message);
    process.exit(1);
  }
}

run().catch(console.error);
