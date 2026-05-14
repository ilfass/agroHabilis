"use strict";

/** Carga tools built-in (efecto lateral al importar). */
require("./builtins");
require("./builtins_workspace");
require("./builtins_consulta_ctx");
require("./builtins_clasificador");
require("./builtins_router");
require("./domain_tools"); // tools domain.* — LLM como router

module.exports = require("./registry");
