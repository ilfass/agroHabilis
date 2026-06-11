"use strict";

const { query } = require("../../config/database");
const H = require("../consultas/legacy_helpers");

async function climaBdMenosDe3h(usuario) {
  const lat = Number(usuario?.lat);
  const lng = Number(usuario?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const r = await query(
    `
      SELECT MAX(creado_en) AS t
      FROM clima
      WHERE ABS(lat - $1::numeric) < 0.2
        AND ABS(lng - $2::numeric) < 0.2
    `,
    [lat, lng]
  );
  const t = r.rows[0]?.t;
  if (!t) return false;
  return Date.now() - new Date(t).getTime() < 3 * 60 * 60 * 1000;
}

const rutaClima = async ({ mensaje, usuario, periodo }) => {
  const frescoBd = usuario ? await climaBdMenosDe3h(usuario) : false;
  if (!frescoBd && usuario) {
    try {
      await H.obtenerClimaFresco({ usuario, texto: mensaje });
    } catch (_e) {
      /* seguimos */
    }
  }

  let esConversacionActiva = false;
  if (usuario?.id) {
    try {
      const rHist = await query(
        `SELECT creado_en FROM historial_consultas 
         WHERE usuario_id = $1 
         ORDER BY creado_en DESC LIMIT 1`,
        [usuario.id]
      );
      const ult = rHist.rows[0]?.creado_en;
      if (ult && (Date.now() - new Date(ult).getTime()) < 15 * 60 * 1000) {
        esConversacionActiva = true;
      }
    } catch (_err) {
      /* ignoramos error de consulta */
    }
  }

  const base = await H.responderClimaPuntual({ usuario, texto: mensaje, periodo });
  try {
    const systemPrompt = [
      "Sos AgroHabilis, un asistente de inteligencia agropecuaria para productores argentinos.",
      "Tu tarea es mejorar y redactar el pronóstico del clima recibido en el Texto base, adaptándolo a un tono sumamente cordial y profesional argentino (es-AR, usando voseo obligatorio: querés, podés, tenés).",
      "Pautas cruciales:",
      "1) Calidad del lenguaje: Escribí en un español rioplatense perfecto y natural. NUNCA mezcles palabras en inglés ni uses traducciones literales incorrectas (por ejemplo: jamás digas 'partials', 'deceived', 'conocedores' ni otras palabras fuera de lugar o mal escritas). Traducí cualquier término inglés si aparece (ej. 'partials' -> parcialmente nublado).",
      "2) Concisión y Claridad: Máximo 5 líneas. Hacé la respuesta extremadamente fácil de leer y prolija.",
      "3) Fidelidad a los datos: Respetá estrictamente los números (temperaturas, milímetros de lluvia, heladas) del Texto base. Jamás inventes valores ni pronósticos que no figuren allí.",
      esConversacionActiva
        ? "4) Conversación activa: Ya venís chateando con el productor. NO saludes al inicio ni vuelvas a decir '¡Hola!' ni introducciones repetitivas. Respondé directamente sobre el clima de forma natural y fluida."
        : "4) Saludo cálido: Podés abrir con un saludo breve y cordial si es la primera interacción, pero mantenelo ágil."
    ].join("\n");

    const r = await H.generarConPromptLibre({
      system: systemPrompt,
      user: `Pregunta del productor:\n${mensaje}\n\nTexto base (no contradecir):\n${base}`,
    });
    const texto = String(r?.texto || "").trim();
    if (texto) {
      return H.enriquecerConGroundingAgroSiHaceFalta({
        pregunta: mensaje,
        textoBase: texto,
        intencion: "clima",
      });
    }
  } catch (_e) {
    /* fallback */
  }

  return H.enriquecerConGroundingAgroSiHaceFalta({
    pregunta: mensaje,
    textoBase: base,
    intencion: "clima",
  });
};

module.exports = { rutaClima };
