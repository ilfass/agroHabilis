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

const rutaClima = async ({ mensaje, usuario }) => {
  const frescoBd = usuario ? await climaBdMenosDe3h(usuario) : false;
  if (!frescoBd && usuario) {
    try {
      await H.obtenerClimaFresco({ usuario, texto: mensaje });
    } catch (_e) {
      /* seguimos */
    }
  }

  const base = await H.responderClimaPuntual({ usuario, texto: mensaje });
  try {
    const r = await H.generarConPromptLibre({
      system:
        "Sos AgroHabilis. Mejorá la redacción del clima en tono cordial (es-AR), máximo 5 líneas, sin inventar números distintos al bloque base.",
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
