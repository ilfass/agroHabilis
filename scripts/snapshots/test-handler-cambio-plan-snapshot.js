#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_cambio_plan` (paso G de P2#10).
 *
 * Cubre los 4 puntos de entrada (alias hard, alias tardío, natural
 * post-IA, natural temprano heurístico) con una sola implementación.
 * Mockea `services/cambio_plan` y `services/whatsapp_intents` para
 * tener control del matching y de las respuestas.
 *
 * Uso: npm run test:handler:cambio-plan
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const cambioPlanPath = path.join(__dirname, "..", "..", "src", "services", "cambio_plan.js");

const state = {
  resolverOut: "[mock] cambio OK",
  resolverShouldThrow: null,
  resolverLast: null,
};

require.cache[cambioPlanPath] = {
  id: cambioPlanPath, filename: cambioPlanPath, loaded: true,
  exports: {
    resolverCambioPlanConPago: async ({ whatsapp, planObjetivo }) => {
      state.resolverLast = { whatsapp, planObjetivo };
      if (state.resolverShouldThrow) throw state.resolverShouldThrow;
      return state.resolverOut;
    },
    mensajeErrorCambioPlan: (error) => {
      if (/falta email/i.test(error?.message || "")) {
        return "[mock] falta email";
      }
      return "[mock] error genérico";
    },
  },
};
Module._cache = require.cache;

const { handlerCmdCambioPlan } = require("../../src/services/turn_handlers/cmd_cambio_plan");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoAlias: "",
  comandoNatural: "",
  planCtx: { usuario: { id: 7 }, planEfectivo: "gratis" },
  ...extra,
});

const reset = () => {
  state.resolverLast = null;
  state.resolverShouldThrow = null;
  state.resolverOut = "[mock] cambio OK";
};

let ok = 0, fail = 0;
const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(64)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

(async () => {
  // Match por ALIAS
  for (const [alias, esperado] of [
    ["QUIERO PLAN PRO", "pro"],
    ["QUIERO PLAN BASICO", "basico"],
    ["QUIERO PLAN GRATIS", "gratis"],
  ]) {
    reset();
    const out = await handlerCmdCambioPlan(baseCtx({ comandoAlias: alias }));
    print(
      `alias "${alias}" → planObjetivo=${esperado}`,
      out.manejado === true &&
        out.route === "CMD_CAMBIO_PLAN" &&
        state.resolverLast?.planObjetivo === esperado
    );
  }

  // Match por NATURAL (post-IA)
  reset();
  {
    const out = await handlerCmdCambioPlan(baseCtx({
      comandoNatural: "QUIERO PLAN PRO",
      consulta: "me podés pasar a pro?",
    }));
    print(
      "natural post-IA QUIERO PLAN PRO → planObjetivo=pro",
      out.manejado === true && state.resolverLast?.planObjetivo === "pro"
    );
  }

  // Match por heurística (natural temprano)
  reset();
  {
    const out = await handlerCmdCambioPlan(baseCtx({
      consulta: "Quiero plan PRO ya",
    }));
    print(
      "heurística natural temprana → planObjetivo=pro",
      out.manejado === true && state.resolverLast?.planObjetivo === "pro"
    );
  }

  // Sin usuario → onboarding
  reset();
  {
    const out = await handlerCmdCambioPlan(baseCtx({
      planCtx: { usuario: null },
      comandoAlias: "QUIERO PLAN PRO",
    }));
    print(
      "sin usuario → mensaje onboarding",
      out.manejado === true &&
        out.route === "CMD_CAMBIO_PLAN_SIN_USUARIO" &&
        /onboarding/i.test(out.respuesta) &&
        state.resolverLast === null
    );
  }

  // Error "falta email"
  reset();
  state.resolverShouldThrow = new Error("falta email para suscripción");
  {
    const out = await handlerCmdCambioPlan(baseCtx({ comandoAlias: "QUIERO PLAN PRO" }));
    print(
      "error 'falta email' → mensaje específico",
      out.manejado === true &&
        out.route === "CMD_CAMBIO_PLAN_ERROR" &&
        /falta email/i.test(out.respuesta)
    );
  }

  // Error genérico
  reset();
  state.resolverShouldThrow = new Error("kaboom");
  {
    const out = await handlerCmdCambioPlan(baseCtx({ comandoAlias: "QUIERO PLAN BASICO" }));
    print(
      "error genérico → mensaje fallback",
      out.manejado === true &&
        out.route === "CMD_CAMBIO_PLAN_ERROR" &&
        /error gen/i.test(out.respuesta)
    );
  }

  // no match: PRECIO SOJA
  reset();
  {
    const out = await handlerCmdCambioPlan(baseCtx({
      comandoAlias: "PRECIO SOJA",
      consulta: "precio soja hoy",
    }));
    print("no match: PRECIO SOJA", out.manejado === false);
  }

  // no match: MI PLAN (consulta, no cambio)
  reset();
  {
    const out = await handlerCmdCambioPlan(baseCtx({
      comandoAlias: "MI PLAN",
      consulta: "mi plan",
    }));
    print("no match: MI PLAN", out.manejado === false);
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error("[handler cambio_plan] error:", e?.message || e, e?.stack);
  process.exit(2);
});
