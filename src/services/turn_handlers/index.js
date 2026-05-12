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
const { handlerCmdBorrarCuenta } = require("./cmd_borrar_cuenta");
const { handlerCmdCompletarPerfil } = require("./cmd_completar_perfil");
const { handlerCmdPerfilDirecto } = require("./cmd_perfil_directo");
const { handlerCmdCambioPlan } = require("./cmd_cambio_plan");
const { handlerCmdAdmin } = require("./cmd_admin");
const { handlerCmdBotControl } = require("./cmd_bot_control");
const { handlerOnboarding } = require("./onboarding");
const { handlerResumenInteractivo } = require("./resumen_interactivo");

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
  cmd_perfil_directo: handlerCmdPerfilDirecto,
  cmd_cambio_plan: handlerCmdCambioPlan,
  cmd_borrar_cuenta: handlerCmdBorrarCuenta,
  cmd_admin: handlerCmdAdmin,
  cmd_completar_perfil: handlerCmdCompletarPerfil,
  strict_suggestion: handlerStrictSuggestion,
  bot_pausado: handlerBotPausado,
  cupo_excedido: handlerCupoExcedido,
  onboarding: handlerOnboarding,
  resumen_interactivo: handlerResumenInteractivo,
  cmd_bot_control: handlerCmdBotControl,
  /* No migrable acá: vive en agent/pipeline/consulta_whatsapp.js */ inventario_pendiente: null,
  /* No migrable acá: es el flujo general, queda en whatsapp.js hasta paso M */ pipeline_agente: null,
};

for (const [id, fn] of Object.entries(HANDLERS)) {
  if (typeof fn === "function") {
    registrarHandler(id, fn);
  }
}

module.exports = { HANDLERS };
