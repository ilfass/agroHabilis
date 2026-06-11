"use strict";

/**
 * Shim: el cuerpo de `procesarConsulta` está en `src/services/consultas.js` (PASO 13).
 */
const { procesarConsulta, obtenerYCompletarPerfil } = require("../consultas");

module.exports = procesarConsulta;
module.exports.obtenerYCompletarPerfil = obtenerYCompletarPerfil;
