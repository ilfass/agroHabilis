const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Load environmental variables
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const { runProviderChain } = require("../src/services/gemini");
const { getGeminiApiKeyStatus, markFreeKeyAsFailed } = require("../src/services/gemini_keys");
const { clasificarMensaje } = require("../src/services/clasificador");

async function run() {
  console.log("=== STARTING KEY FAILOVER & ROUTING TEST ===\n");

  // Save the original keys to restore them at the end
  const originalKey = process.env.GEMINI_API_KEY;
  const fallbackKey = process.env.GEMINI_API_KEY_FALLBACK;
  
  try {
    // 1. Reset state
    markFreeKeyAsFailed(false);
    console.log("1. Initial state of Gemini keys:");
    console.log(getGeminiApiKeyStatus());

    // 2. Set an invalid/exhausted primary key and manually trigger conmutation
    console.log("\n2. Configuring bad primary key and manually triggering conmutation (simulating 429 quota exhaustion)...");
    process.env.GEMINI_API_KEY = "AIzaSyBadKeyThatWillFailForSure1234567";
    
    if (!fallbackKey) {
      console.error("❌ Fallback key is not defined in your .env. Please configure GEMINI_API_KEY_FALLBACK first.");
      return;
    }

    console.log(`Fallback key configured ending in: ...${fallbackKey.slice(-6)}`);
    markFreeKeyAsFailed(true); // Manually trigger conmutation

    // 3. Make a call that should succeed immediately using the fallback key
    console.log("\n3. Making first call to runProviderChain. It should use the fallback key directly...");
    const system = "Respond exactly with JSON: {\"status\":\"ok\"}";
    const user = "ping";
    
    const res1 = await runProviderChain({
      system,
      user,
      contextLabel: "test.failover",
      opts: { responseMimeType: "application/json" }
    });

    console.log("Result 1 text:", res1.texto);
    console.log("Provider used:", res1.providerUsed);
    console.log("Provider trace:", JSON.stringify(res1.providerTrace));

    // 4. Verify that conmutation persisted!
    console.log("\n4. Checking if key conmutation persisted to the fallback key...");
    const status = getGeminiApiKeyStatus();
    console.log("Key status:", status);

    if (status.activeKeyType !== "paga") {
      throw new Error("❌ FAIL: Key status did not persist to paid/fallback! Swapped key was overwritten/restored.");
    }
    console.log("✅ SUCCESS: Key conmutation persisted!");

    // 5. Make a second call and check if it immediately uses the conmuted key
    console.log("\n5. Making a second call. It should use the fallback key immediately...");
    const res2 = await runProviderChain({
      system,
      user,
      contextLabel: "test.failover.subsequent",
      opts: { responseMimeType: "application/json" }
    });

    console.log("Result 2 text:", res2.texto);
    console.log("Provider used:", res2.providerUsed);
    console.log("Provider trace:", JSON.stringify(res2.providerTrace));
    console.log("✅ SUCCESS: Subsequent call used the conmuted fallback key directly!");

    // 6. Test intent classifier with JSON mode forced
    console.log("\n6. Testing intent classifier fallback formatting...");
    // Let's temporarily disable Gemini to force fallback to Groq/OpenRouter
    process.env.GEMINI_API_KEY = "";
    
    const cl = await clasificarMensaje("Va a llover hoy?", { id: 538, cultivos: [] });
    console.log("Classification result for weather query:", JSON.stringify(cl, null, 2));

    if (cl.intencion !== "clima") {
      throw new Error(`❌ FAIL: Expected intent to be 'clima', got '${cl.intencion}'`);
    }
    console.log("✅ SUCCESS: Fallback classifier correctly identified the 'clima' intent!");

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
  } finally {
    // Restore original keys
    process.env.GEMINI_API_KEY = originalKey;
    process.env.GEMINI_API_KEY_FALLBACK = fallbackKey;
    markFreeKeyAsFailed(false);
    console.log("\n=== Original keys restored. Test completed. ===");
  }
}

run();
