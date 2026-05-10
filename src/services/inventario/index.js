"use strict";

const core = require("./core");
const nl = require("./nl_heuristica");
const wa = require("./whatsapp_flow");

module.exports = {
  ...core,
  ...nl,
  manejarInventarioWhatsapp: wa.manejarInventarioWhatsapp,
  formatearSaldosWhatsapp: wa.formatearSaldosWhatsapp,
};
