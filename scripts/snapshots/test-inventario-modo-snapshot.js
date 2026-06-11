#!/usr/bin/env node
/**
 * Flags de modo agente (defaults ON en código; acá forzamos OFF/ON explícito).
 *
 *   node scripts/test-inventario-modo-snapshot.js
 */

"use strict";

const assert = require("assert");
const {
  inventarioSoloLlm,
  dialogoHiloSinAtajoHeuristico,
  cursorMode,
  defaultOnUnlessOff,
  agentIaTotal,
} = require("../../src/services/agent/cursor_mode");
const { unifiedTurnLoopHabilitado, clasificadorDeferidoAlBucleUnificado } = require("../../src/services/agent/ia/unified_turn_loop");

const limpiar = () => {
  process.env.AGENT_CURSOR_MODE = "0";
  process.env.AGENT_IA_TOTAL = "0";
  process.env.AGENT_UNIFIED_TURN_LOOP = "0";
  process.env.AGENT_CLASIFICADOR_EN_BUCLE = "0";
  process.env.INVENTARIO_SOLO_LLM = "0";
  process.env.DIALOGO_HILO_SIN_ATAJO_HEURISTICO = "0";
};

const main = () => {
  limpiar();
  assert.strictEqual(cursorMode(), false);
  assert.strictEqual(agentIaTotal(), false);
  assert.strictEqual(unifiedTurnLoopHabilitado(), false);
  assert.strictEqual(clasificadorDeferidoAlBucleUnificado(), false);
  assert.strictEqual(inventarioSoloLlm(), false);
  assert.strictEqual(dialogoHiloSinAtajoHeuristico(), false);

  delete process.env.AGENT_CURSOR_MODE;
  assert.strictEqual(defaultOnUnlessOff("AGENT_CURSOR_MODE"), true);
  assert.strictEqual(cursorMode(), true);
  delete process.env.AGENT_IA_TOTAL;
  assert.strictEqual(defaultOnUnlessOff("AGENT_IA_TOTAL"), true);
  assert.strictEqual(agentIaTotal(), true);
  limpiar();

  process.env.INVENTARIO_SOLO_LLM = "1";
  assert.strictEqual(inventarioSoloLlm(), true);
  limpiar();

  process.env.INVENTARIO_SOLO_LLM = "0";
  process.env.AGENT_CURSOR_MODE = "1";
  assert.strictEqual(inventarioSoloLlm(), false);
  assert.strictEqual(cursorMode(), true);
  limpiar();

  console.log("  ✓ test-inventario-modo-snapshot: flags OK");
};

main();
