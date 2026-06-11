#!/usr/bin/env node
/**
 * Snapshot tests de cmd_borrar_cuenta (paso H) y cmd_completar_perfil (paso J).
 *
 * Uso: npm run test:handler:borrar-completar
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const usuarioPath = path.join(__dirname, "..", "..", "src", "models", "usuario.js");
const onboardingPath = path.join(__dirname, "..", "..", "src", "services", "onboarding.js");

const state = {
  eliminadoOut: true,
  gestionarOut: { enFlujo: false, respuesta: "" },
  eliminarCalled: 0,
};

require.cache[usuarioPath] = {
  id: usuarioPath, filename: usuarioPath, loaded: true,
  exports: {
    eliminarUsuarioSoft: async () => {
      state.eliminarCalled += 1;
      return state.eliminadoOut;
    },
  },
};
require.cache[onboardingPath] = {
  id: onboardingPath, filename: onboardingPath, loaded: true,
  exports: {
    gestionarCompletarPerfil: async () => state.gestionarOut,
  },
};
Module._cache = require.cache;

const { handlerCmdBorrarCuenta } = require("../../src/services/turn_handlers/cmd_borrar_cuenta");
const { handlerCmdCompletarPerfil } = require("../../src/services/turn_handlers/cmd_completar_perfil");

let ok = 0, fail = 0;
const enviadosReply = [];
const replyCtx = {
  replySinIA: async (t) => enviadosReply.push(t),
};

const ctxBase = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoAlias: "",
  comandoUpper: "",
  comandoNatural: "",
  planCtx: { usuario: { id: 1 } },
  ...replyCtx,
  ...extra,
});

const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(64)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

(async () => {
  // -------- cmd_borrar_cuenta --------
  {
    enviadosReply.length = 0;
    const out = await handlerCmdBorrarCuenta(ctxBase({
      comandoUpper: "BORRAR MIS DATOS",
      consulta: "borrar mis datos",
    }));
    print(
      "BORRAR MIS DATOS → paso 1 (advertencia)",
      out.manejado === true &&
        out.route === "CMD_BORRAR_CUENTA_PASO1" &&
        enviadosReply[0]?.includes("SI BORRO MIS DATOS")
    );
  }
  {
    enviadosReply.length = 0;
    const out = await handlerCmdBorrarCuenta(ctxBase({
      comandoNatural: "BORRAR MIS DATOS",
      consulta: "quiero dar de baja la cuenta",
    }));
    print(
      "natural BORRAR MIS DATOS → paso 1",
      out.manejado === true && enviadosReply[0]?.includes("⚠️")
    );
  }
  {
    enviadosReply.length = 0;
    const out = await handlerCmdBorrarCuenta(ctxBase({
      planCtx: { usuario: null },
      comandoUpper: "BORRAR MIS DATOS",
    }));
    print(
      "BORRAR MIS DATOS sin usuario → corta",
      out.manejado === true && enviadosReply[0]?.includes("No hay una cuenta")
    );
  }
  {
    enviadosReply.length = 0;
    state.eliminadoOut = true;
    state.eliminarCalled = 0;
    const out = await handlerCmdBorrarCuenta(ctxBase({
      comandoUpper: "SI BORRO MIS DATOS",
    }));
    print(
      "SI BORRO MIS DATOS → ejecuta y confirma",
      out.manejado === true &&
        out.route === "CMD_BORRAR_CUENTA_CONFIRMADO" &&
        state.eliminarCalled === 1 &&
        enviadosReply[0]?.includes("✅")
    );
  }
  {
    enviadosReply.length = 0;
    state.eliminadoOut = false;
    const out = await handlerCmdBorrarCuenta(ctxBase({
      comandoUpper: "SI BORRO MIS DATOS",
    }));
    print(
      "SI BORRO MIS DATOS pero no había usuario en DB",
      out.manejado === true && enviadosReply[0]?.includes("No pude encontrar")
    );
  }
  {
    enviadosReply.length = 0;
    const out = await handlerCmdBorrarCuenta(ctxBase({
      comandoUpper: "PRECIO SOJA",
    }));
    print("no match: PRECIO SOJA", out.manejado === false);
  }

  // -------- cmd_completar_perfil --------
  {
    state.gestionarOut = { enFlujo: true, respuesta: "Decime tu nombre" };
    const out = await handlerCmdCompletarPerfil(ctxBase({
      comandoNatural: "COMPLETAR PERFIL",
    }));
    print(
      "COMPLETAR PERFIL natural → inicia flujo",
      out.manejado === true && out.route === "CMDN_COMPLETAR_PERFIL"
    );
  }
  {
    state.gestionarOut = { enFlujo: false };
    const out = await handlerCmdCompletarPerfil(ctxBase({
      comandoNatural: "COMPLETAR PERFIL",
    }));
    print(
      "COMPLETAR PERFIL pero no inicia → cede turno",
      out.manejado === false
    );
  }
  {
    const out = await handlerCmdCompletarPerfil(ctxBase({
      comandoNatural: "MI RESUMEN",
    }));
    print("no match: MI RESUMEN", out.manejado === false);
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(2); });
