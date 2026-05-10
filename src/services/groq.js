const axios = require("axios");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const getModel = () =>
  process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant";

const generarChatGroq = async ({ system, user }) => {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY no configurada");
  }

  const model = getModel();
  try {
    const { data } = await axios.post(
      GROQ_URL,
      {
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: Number(process.env.IA_TIMEOUT_MS || 15000),
      }
    );

    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) {
      throw new Error("Groq no devolvio contenido en choices[0].message");
    }

    const usage = data?.usage;
    const tokensUsados =
      typeof usage?.total_tokens === "number" ? usage.total_tokens : null;

    return { texto, tokensUsados, model: data?.model || model };
  } catch (error) {
    const apiMsg =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message;
    throw new Error(`Groq: ${apiMsg}`);
  }
};

module.exports = { generarChatGroq };
