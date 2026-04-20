const { GoogleGenerativeAI } = require("@google/generative-ai");

const getModelName = () =>
  process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

const generarResumenMercado = async (textoContexto) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no configurada");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: getModelName() });

  const prompt = [
    "Sos un asistente agropecuario para productores argentinos.",
    "Genera un resumen breve (maximo 8 lineas) en espanol rioplatense.",
    "Prioriza claridad: cultivos, rangos o valores representativos, moneda (ARS/USD) y fecha.",
    "No inventes datos fuera del contexto. Si falta informacion, decilo explicitamente.",
    "",
    "Contexto:",
    textoContexto,
  ].join("\n");

  const result = await model.generateContent(prompt);
  const texto = result.response.text();

  const usage = result.response.usageMetadata;
  const tokensUsados =
    typeof usage?.totalTokenCount === "number"
      ? usage.totalTokenCount
      : null;

  return { texto, tokensUsados, model: getModelName() };
};

module.exports = {
  generarResumenMercado,
};
