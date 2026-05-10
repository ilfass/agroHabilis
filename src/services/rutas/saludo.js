"use strict";

const { textoParaClasificacionSaludo } = require("../whatsapp_intents");
const H = require("../consultas/legacy_helpers");

const rutaSaludo = async ({ usuario, mensaje }) => {
  const preguntaSaludo = textoParaClasificacionSaludo(mensaje);
  const rapida = H.responderSaludoPlantillaRapida(usuario, preguntaSaludo);
  try {
    const ia = await H.generarSaludoIAControlado({
      usuario,
      pregunta: preguntaSaludo,
    });
    if (String(ia || "").trim()) return String(ia).trim();
  } catch (_e) {
    /* */
  }
  return rapida;
};

module.exports = { rutaSaludo };
