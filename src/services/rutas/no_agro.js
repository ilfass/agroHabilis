"use strict";

const H = require("../consultas/legacy_helpers");

const rutaNoAgro = async ({ mensaje, usuario }) =>
  H.responderNoAgroConGrounding({ usuario, pregunta: mensaje });

module.exports = { rutaNoAgro };
