"use strict";

require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getGeminiApiKey } = require("../src/services/gemini_keys");

async function test() {
  const apiKey = getGeminiApiKey();
  console.log("Using API Key:", apiKey ? `${apiKey.slice(0, 8)}...` : "none");
  const genAI = new GoogleGenerativeAI(apiKey);

  const models = ["text-embedding-004", "embedding-001", "gemini-embedding-001"];
  for (const m of models) {
    try {
      console.log(`\nTesting model: ${m}...`);
      const model = genAI.getGenerativeModel({ model: m });
      const res = await model.embedContent({
        content: { parts: [{ text: "Hola mundo" }] },
        outputDimensionality: 768
      });
      console.log(`Success! ${m} embedding length: ${res.embedding.values.length}`);
      return m;
    } catch (e) {
      console.error(`Failed ${m}: ${e.message}`);
    }
  }
}

test();
