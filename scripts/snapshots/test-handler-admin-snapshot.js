#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_admin` (paso I de P2#10).
 *
 * Mockea `services/admin_comandos` (no toca DB ni runtime de WA).
 *
 * Uso: npm run test:handler:admin
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const adminPath = path.join(__dirname, "..", "..", "src", "services", "admin_comandos.js");

const state = {
  responderResult: "[mock] respuesta admin",
  resetResult: { ok: true, numero: "549111", onboarding: 1, botControl: 1, consultasNull: 2, usuariosEliminados: 1 },
  lastResponder: null,
  lastReset: null,
};

require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    responderComandoAdmin: async (from, comando, opts) => {
      state.lastResponder = { from, comando, opts };
      return state.responderResult;
    },
    resetOnboardingNumero: async (numero) => {
      state.lastReset = numero;
      return state.resetResult;
    },
  },
};
Module._cache = require.cache;

const { handlerCmdAdmin } = require("../../src/services/turn_handlers/cmd_admin");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoAlias: "",
  esAdmin: true,
  getEstadoWhatsapp: () => "listo",
  ...extra,
});

const reset = () => {
  state.lastResponder = null;
  state.lastReset = null;
  state.responderResult = "[mock] respuesta admin";
  state.resetResult = { ok: true, numero: "549111", onboarding: 1, botControl: 1, consultasNull: 2, usuariosEliminados: 1 };
};

let ok = 0, fail = 0;
const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(64)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

(async () => {
  // RESET ONBOARDING como admin
  reset();
  {
    const out = await handlerCmdAdmin(baseCtx({
      comandoAlias: "RESET ONBOARDING 549111",
      consulta: "RESET ONBOARDING 549111",
    }));
    print(
      "RESET ONBOARDING (admin) → ejecuta y devuelve resumen",
      out.manejado === true &&
        out.route === "CMD_RESET_ONBOARDING_OK" &&
        state.lastReset === "549111" &&
        /Onboarding reseteado/.test(out.respuesta) &&
        /usuarios eliminados: 1/.test(out.respuesta)
    );
  }

  // RESET ONBOARDING sin ser admin
  reset();
  {
    const out = await handlerCmdAdmin(baseCtx({
      esAdmin: false,
      comandoAlias: "RESET ONBOARDING 549111",
      consulta: "RESET ONBOARDING 549111",
    }));
    print(
      "RESET ONBOARDING (no admin) → denegado, NO toca DB",
      out.manejado === true &&
        out.route === "CMD_RESET_ONBOARDING_DENEGADO" &&
        state.lastReset === null &&
        /administradores/i.test(out.respuesta)
    );
  }

  // RESET ONBOARDING con error de número inválido
  reset();
  state.resetResult = { ok: false, error: "Número inválido. Usá: RESET ONBOARDING 549XXXXXXXXXX" };
  {
    const out = await handlerCmdAdmin(baseCtx({
      comandoAlias: "RESET ONBOARDING X",
      consulta: "RESET ONBOARDING x",
    }));
    print(
      "RESET ONBOARDING con número inválido → error",
      out.manejado === true &&
        out.route === "CMD_RESET_ONBOARDING_ERR" &&
        /Número inválido/i.test(out.respuesta)
    );
  }

  // ESTADO (admin) → delega y propaga opts
  reset();
  {
    const out = await handlerCmdAdmin(baseCtx({
      comandoAlias: "ESTADO",
      consulta: "ESTADO",
    }));
    print(
      "ESTADO (admin) → delega a responderComandoAdmin y propaga esAdmin+getEstado",
      out.manejado === true &&
        out.route === "CMD_ADMIN" &&
        state.lastResponder?.opts?.esAdmin === true &&
        typeof state.lastResponder?.opts?.getEstadoWhatsapp === "function"
    );
  }

  // ESTADO (no admin) → responderComandoAdmin devuelve denegado
  reset();
  state.responderResult = "Este comando es solo para administradores.";
  {
    const out = await handlerCmdAdmin(baseCtx({
      esAdmin: false,
      comandoAlias: "ESTADO",
      consulta: "ESTADO",
    }));
    print(
      "ESTADO (no admin) → route=CMD_ADMIN_DENEGADO",
      out.manejado === true && out.route === "CMD_ADMIN_DENEGADO"
    );
  }

  // No match: responderComandoAdmin devuelve null para comandos fuera del catálogo
  reset();
  state.responderResult = null;
  {
    const out = await handlerCmdAdmin(baseCtx({
      comandoAlias: "PRECIO SOJA",
      consulta: "precio soja",
    }));
    print(
      "no match: PRECIO SOJA",
      out.manejado === false
    );
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error("[handler admin] error:", e?.message || e, e?.stack);
  process.exit(2);
});
