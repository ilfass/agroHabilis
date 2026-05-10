"use strict";

/**
 * Contexto de mercado reutilizable (PASO 4 y PASO 5 del spec):
 * noticias 24h + template "consulta", que internamente arma snapshot y demás datos.
 */
const H = require("../consultas/legacy_helpers");
const { obtenerNoticiasFrescas } = require("../../templates/base");

async function preguntaConNoticiasMercado({ clasificacion, mensaje, extraKeys = [] } = {}) {
  const keys = [
    ...new Set(
      [clasificacion?.cultivo, clasificacion?.producto, ...(extraKeys || [])]
        .filter(Boolean)
        .map((k) => String(k).trim())
    ),
  ];
  const noticias = await obtenerNoticiasFrescas(keys, 4);
  const bloqueNotas =
    noticias.length > 0
      ? `\n\n_Noticias últimas 24h:_\n${noticias
          .map((n) => `• ${n.titulo}${n.fuente ? ` (${n.fuente})` : ""}`)
          .join("\n")}`
      : "";
  return `${mensaje}${bloqueNotas}`;
}

async function renderConsultaConMercadoYNoticias({ clasificacion, mensaje, usuario, extraKeys } = {}) {
  const preguntaEnriquecida = await preguntaConNoticiasMercado({
    clasificacion,
    mensaje,
    extraKeys,
  });
  const out = await H.renderTemplate("consulta", usuario, preguntaEnriquecida);
  return H.sanitizarPlaceholders(String(out?.mensaje || "").trim());
}

module.exports = { preguntaConNoticiasMercado, renderConsultaConMercadoYNoticias };
