"use strict";

/**
 * Reemplaza placeholders de nombre en plantillas de envío masivo (admin).
 * @param {string} plantilla
 * @param {{ nombre?: string|null }} u
 */
const interpolarMensajeMasivo = (plantilla, u) => {
  const nombre = String(u?.nombre || "").trim() || "productor";
  let t = String(plantilla || "");
  t = t.replace(/\{\{\}\s*nombrer\s*\}+/gi, nombre);
  t = t.replace(/\{\{\s*(nombre|nombrer)\s*\}\}/gi, nombre);
  t = t.replace(/\{\s*nombre\s*\}/gi, nombre);
  return t;
};

module.exports = { interpolarMensajeMasivo };
