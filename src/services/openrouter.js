const axios = require("axios");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const getModel = () =>
  process.env.OPENROUTER_MODEL?.trim() || "openrouter/free";

/**
 * Chat compatible con OpenAI v1 (OpenRouter).
 * @returns {{ texto: string, tokensUsados: number|null, model: string }}
 */
const generarChatOpenRouter = async ({ system, user }) => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY no configurada");
  }

  const model = getModel();
  const referer =
    process.env.OPENROUTER_HTTP_REFERER?.trim() || "https://agrohabilis.local";

  try {
    const { data } = await axios.post(
      OPENROUTER_URL,
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
          "HTTP-Referer": referer,
          "X-Title": "AgroHabilis",
        },
        timeout: Number(process.env.IA_TIMEOUT_MS || 15000),
      }
    );

    const texto = data?.choices?.[0]?.message?.content?.trim();
    if (!texto) {
      throw new Error("OpenRouter no devolvio contenido en choices[0].message");
    }

    const usage = data?.usage;
    const tokensUsados =
      typeof usage?.total_tokens === "number" ? usage.total_tokens : null;
    const modelUsado = data?.model || model;

    return { texto, tokensUsados, model: modelUsado };
  } catch (error) {
    const apiMsg =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message;
    throw new Error(`OpenRouter: ${apiMsg}`);
  }
};

module.exports = {
  generarChatOpenRouter,
};
