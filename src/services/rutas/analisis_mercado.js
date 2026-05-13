"use strict";

const H = require("../consultas/legacy_helpers");
const { renderConsultaConMercadoYNoticias } = require("./consulta_contexto_mercado");

/** PASO 4: snapshot/noticias vía template consulta + noticias explícitas. */
const rutaAnalisisMercado = async ({ clasificacion, mensaje, usuario }) => {
  const texto = await renderConsultaConMercadoYNoticias({ clasificacion, mensaje, usuario });
  return H.enriquecerConGroundingAgroSiHaceFalta({
    pregunta: mensaje,
    textoBase: texto,
    intencion: "analisis_mercado",
  });
};

module.exports = { rutaAnalisisMercado };
