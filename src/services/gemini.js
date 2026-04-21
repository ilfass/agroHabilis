const { GoogleGenerativeAI } = require("@google/generative-ai");
const { generarChatOpenRouter } = require("./openrouter");

const getModelName = () =>
  process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

const generarTexto = async (prompt) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no configurada");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: getModelName() });
  const result = await model.generateContent(prompt);
  const texto = result.response.text();
  const usage = result.response.usageMetadata;
  const tokensUsados =
    typeof usage?.totalTokenCount === "number"
      ? usage.totalTokenCount
      : null;

  return { texto, tokensUsados, model: getModelName() };
};

const generarResumenMercado = async (textoContexto) => {
  const prompt = [
    "Sos un asistente agropecuario para productores argentinos.",
    "Genera un resumen breve (maximo 8 lineas) en espanol rioplatense.",
    "Prioriza claridad: cultivos, rangos o valores representativos, moneda (ARS/USD) y fecha.",
    "No inventes datos fuera del contexto. Si falta informacion, decilo explicitamente.",
    "",
    "Contexto:",
    textoContexto,
  ].join("\n");
  return generarTexto(prompt);
};

const generarConPromptLibre = async ({ system, user }) => {
  if (!system || !user) {
    throw new Error("Faltan system/user para generarConPromptLibre");
  }

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    try {
      return await generarChatOpenRouter({ system, user });
    } catch (error) {
      console.warn(
        "[IA] OpenRouter fallo, se intenta Gemini:",
        error.message
      );
    }
  }

  const prompt = `${system}\n\n${user}`;
  return generarTexto(prompt);
};

const generarRespuestaConsulta = async ({ contextoDatos, pregunta }) => {
  const systemPrompt = [
    "Sos el asistente de AgroHabilis, una herramienta de inteligencia",
    "agropecuaria para productores argentinos. Respondés consultas sobre",
    "precios de granos, clima y mercados de forma clara, directa y en",
    "lenguaje simple. No usás tecnicismos innecesarios. Siempre mencionás",
    "la fecha de los datos que estás usando. Si no tenés datos suficientes",
    "para responder, lo decís claramente.",
    "",
    "Datos disponibles al momento de esta consulta:",
    contextoDatos,
  ].join("\n");

  const userContent = [
    `Consulta del productor:`,
    pregunta,
    "",
    "Respondé en español rioplatense, de forma directa.",
  ].join("\n");

  if (process.env.OPENROUTER_API_KEY?.trim()) {
    try {
      return await generarChatOpenRouter({
        system: systemPrompt,
        user: userContent,
      });
    } catch (error) {
      console.warn(
        "[IA] OpenRouter fallo, se intenta Gemini:",
        error.message
      );
    }
  }

  const prompt = `${systemPrompt}\n\n${userContent}\n\nRespuesta:`;
  return generarTexto(prompt);
};

module.exports = {
  generarConPromptLibre,
  generarResumenMercado,
  generarRespuestaConsulta,
};
