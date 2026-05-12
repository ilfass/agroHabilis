"use strict";

/**
 * Punto de entrada de los handlers del TurnController.
 *
 * Cada handler se registra acá al cargar el módulo. Para enchufar uno
 * nuevo: importarlo y agregar `registrarHandler(...)`.
 *
 * Ver `src/services/turn_handlers/README.md` para el patrón y la lista
 * de handlers pendientes de migrar.
 */

const { registrarHandler } = require("../agent/turn_controller");

const { handlerCmdFlete } = require("./cmd_flete");
const { handlerCmdResumen } = require("./cmd_resumen");
const { handlerCmdAlertas } = require("./cmd_alertas");
const { handlerCmdFinanzas } = require("./cmd_finanzas");
const { handlerStrictSuggestion } = require("./strict_suggestion");
const { handlerBotPausado } = require("./bot_pausado");
const { handlerCupoExcedido } = require("./cupo_excedido");

/**
 * Mapeo id → función. Acá agregamos los pasos siguientes a medida que
 * los handlers se migran (cada migración es un PR aparte; ver
 * `docs/operacion/turn-controller-propuesta.md`).
 */
const HANDLERS = {
  cmd_flete: handlerCmdFlete,
  cmd_resumen: handlerCmdResumen,
  cmd_alertas: handlerCmdAlertas,
  cmd_finanzas: handlerCmdFinanzas,
  /* TODO paso F */ cmd_perfil_directo: null,
  /* TODO paso G */ cmd_cambio_plan: null,
  /* TODO paso H */ cmd_borrar_cuenta: null,
  /* TODO paso I */ cmd_admin: null,
  /* TODO paso J */ cmd_completar_perfil: null,
  strict_suggestion: handlerStrictSuggestion,
  bot_pausado: handlerBotPausado,
  cupo_excedido: handlerCupoExcedido,
  /* TODO paso L */ onboarding: null,
  /* TODO paso L */ resumen_interactivo: null,
  /* TODO paso L */ inventario_pendiente: null,
  /* TODO paso L */ cmd_bot_control: null,
  /* TODO paso L */ pipeline_agente: null,
};

for (const [id, fn] of Object.entries(HANDLERS)) {
  if (typeof fn === "function") {
    registrarHandler(id, fn);
  }
}

module.exports = { HANDLERS };
