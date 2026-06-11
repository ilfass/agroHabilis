"use strict";

/**
 * Archivado 2026-05-11: barrel `inventario/index.js` sin ningún `require()` en el repo.
 * No importar desde producción; conservado como referencia. Rutas relativas válidas desde esta carpeta.
 */

const core = require("../inventario/core");
const nl = require("../inventario/nl_heuristica");
const wa = require("../inventario/whatsapp_flow");

module.exports = {
  ...core,
  ...nl,
  manejarInventarioWhatsapp: wa.manejarInventarioWhatsapp,
  formatearSaldosWhatsapp: wa.formatearSaldosWhatsapp,
};
