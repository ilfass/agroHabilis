const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Load environmental variables
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const { getGeminiApiKeyStatus, markFreeKeyAsFailed, getGeminiApiKey, keysPool } = require("../src/services/gemini_keys");

async function run() {
  console.log("=== STARTING GEMINI KEYS POOL ROTATION TEST ===\n");

  console.log("Keys Pool parsed from env:", keysPool.length, "keys found.");
  keysPool.forEach((key, idx) => {
    console.log(`Key ${idx + 1}: ends with ...${key.slice(-6)}`);
  });

  if (keysPool.length < 3) {
    console.error("❌ Test requires at least 3 keys in GEMINI_API_KEY_POOL. Configure it in .env first.");
    return;
  }

  // 1. Initial State
  markFreeKeyAsFailed(false); // Reset
  let status = getGeminiApiKeyStatus();
  console.log("\n1. Initial state:");
  console.log(status);
  if (status.activeKeyIndex !== 0 || getGeminiApiKey() !== keysPool[0]) {
    throw new Error("❌ FAIL: Initial active key is not Key 1.");
  }
  console.log("✅ Initial state OK.");

  // 2. Simulate Key 1 failing
  console.log("\n2. Simulating Key 1 failing...");
  markFreeKeyAsFailed(true);
  status = getGeminiApiKeyStatus();
  console.log("State after first failure:", status);
  if (status.activeKeyIndex !== 1 || getGeminiApiKey() !== keysPool[1]) {
    throw new Error("❌ FAIL: Did not rotate to Key 2 after Key 1 failed.");
  }
  console.log("✅ Rotated to Key 2 OK.");

  // 3. Simulate Key 2 failing
  console.log("\n3. Simulating Key 2 failing...");
  markFreeKeyAsFailed(true);
  status = getGeminiApiKeyStatus();
  console.log("State after second failure:", status);
  if (status.activeKeyIndex !== 2 || getGeminiApiKey() !== keysPool[2]) {
    throw new Error("❌ FAIL: Did not rotate to Key 3 after Key 2 failed.");
  }
  console.log("✅ Rotated to Key 3 OK.");

  // 4. Simulate Key 3 failing
  console.log("\n4. Simulating Key 3 failing...");
  markFreeKeyAsFailed(true);
  status = getGeminiApiKeyStatus();
  console.log("State after third failure:", status);
  if (status.activeKeyIndex !== 3 || getGeminiApiKey() !== keysPool[3]) {
    throw new Error("❌ FAIL: Did not rotate to Key 4 after Key 3 failed.");
  }
  console.log("✅ Rotated to Key 4 OK.");

  // 5. Simulate all keys failing (exhaustion & self-healing reset)
  console.log("\n5. Simulating Key 4 failing (exhausting all keys)...");
  markFreeKeyAsFailed(true);
  status = getGeminiApiKeyStatus();
  console.log("State after pool exhaustion:", status);
  // It should reset failed set, and select the next key (Key 1)
  if (status.activeKeyIndex !== 0 || getGeminiApiKey() !== keysPool[0]) {
    throw new Error("❌ FAIL: Pool did not auto-reset and wrap around to Key 1.");
  }
  console.log("✅ Pool auto-reset and wrapped around to Key 1 OK.");

  // 6. Reset manually
  console.log("\n6. Simulating manual reset...");
  markFreeKeyAsFailed(false);
  status = getGeminiApiKeyStatus();
  console.log("State after manual reset:", status);
  if (status.activeKeyIndex !== 0 || status.failedKeysCount !== 0) {
    throw new Error("❌ FAIL: Manual reset failed.");
  }
  console.log("✅ Manual reset OK.");

  console.log("\n=== ALL TESTS PASSED SUCCESSFULLY! 100% OK ✅ ===");
}

run().catch((e) => {
  console.error("Test error:", e.message);
});
