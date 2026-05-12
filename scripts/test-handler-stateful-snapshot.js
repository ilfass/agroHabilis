#!/usr/bin/env node
/**
 * Snapshot tests de los 3 handlers stateful migrados en el paso L:
 * - `cmd_bot_control`
 * - `onboarding`
 * - `resumen_interactivo`
 *
 * Mockea agresivamente DB y servicios para no salir del proceso de Node
 * (algunos servicios cargan whatsapp.js indirectamente).
 *
 * Uso: npm run test:handler:stateful
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const PATHS = {
  consultas: path.join(__dirname, "..", "src", "services", "consultas.js"),
  onboarding: path.join(__dirname, "..", "src", "services", "onboarding.js"),
  resumen: path.join(__dirname, "..", "src", "services", "resumen_interactivo.js"),
  estado: path.join(__dirname, "..", "src", "services", "conversacion_estado.js"),
  textos: path.join(__dirname, "..", "src", "services", "whatsapp_textos.js"),
  usuarioModel: path.join(__dirname, "..", "src", "models", "usuario.js"),
};

const state = {
  comandoBotOut: null,
  onboardingOut: { enOnboarding: false },
  resumenManejaCb: async () => false,
  estado: null,
  estadoPorUsuario: null,
  sendCalls: [],
  capturaCalls: [],
};

// Mock services/consultas (solo necesitamos manejarComandoBot)
require.cache[PATHS.consultas] = {
  id: PATHS.consultas, filename: PATHS.consultas, loaded: true,
  exports: {
    manejarComandoBot: async (_jid, _consulta) => state.comandoBotOut,
    obtenerEstadoBot: async () => true,
    procesarConsulta: async () => "",
  },
};

require.cache[PATHS.onboarding] = {
  id: PATHS.onboarding, filename: PATHS.onboarding, loaded: true,
  exports: {
    gestionarOnboarding: async (_jid, _consulta) => state.onboardingOut,
    gestionarCompletarPerfil: async () => ({ enFlujo: false }),
  },
};

require.cache[PATHS.resumen] = {
  id: PATHS.resumen, filename: PATHS.resumen, loaded: true,
  exports: {
    procesarRespuestaResumen: async ({ enviar, mensaje }) => {
      return state.resumenManejaCb({ enviar, mensaje });
    },
  },
};

require.cache[PATHS.estado] = {
  id: PATHS.estado, filename: PATHS.estado, loaded: true,
  exports: {
    obtenerEstado: async (_k) => state.estado,
    obtenerEstadoResumenInteractivoPorUsuarioId: async (_id) => state.estadoPorUsuario,
  },
};

require.cache[PATHS.textos] = {
  id: PATHS.textos, filename: PATHS.textos, loaded: true,
  exports: {
    formatearRespuestaAmigable: (t) => String(t || ""),
  },
};

require.cache[PATHS.usuarioModel] = {
  id: PATHS.usuarioModel, filename: PATHS.usuarioModel, loaded: true,
  exports: {
    normalizarWhatsapp: (n) => String(n || "").replace(/\D/g, ""),
    buscarPorWhatsapp: async () => null,
    registrarIdentidadWhatsapp: async () => {},
    extraerIdentidadWhatsapp: () => ({ numero: "", numeroReal: "" }),
    actualizarPerfilProductivo: async () => {},
    eliminarUsuarioSoft: async () => true,
  },
};

Module._cache = require.cache;

const { handlerCmdBotControl } = require("../src/services/turn_handlers/cmd_bot_control");
const { handlerOnboarding } = require("../src/services/turn_handlers/onboarding");
const { handlerResumenInteractivo } = require("../src/services/turn_handlers/resumen_interactivo");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  numeroNormalizado: "549111",
  consulta: "",
  comandoAlias: "",
  esAdmin: false,
  planCtx: { usuario: { id: 7 } },
  send: async (t) => { state.sendCalls.push(t); },
  emitCaptura: (cuerpo, ruta) => { state.capturaCalls.push({ cuerpo, ruta }); },
  ...extra,
});

const resetState = () => {
  state.comandoBotOut = null;
  state.onboardingOut = { enOnboarding: false };
  state.resumenManejaCb = async () => false;
  state.estado = null;
  state.estadoPorUsuario = null;
  state.sendCalls.length = 0;
  state.capturaCalls.length = 0;
};

let ok = 0, fail = 0;
const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(70)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

(async () => {
  // ===== cmd_bot_control =====
  resetState();
  {
    state.comandoBotOut = "🤖 Bot pausado. Escribí ACTIVAR BOT para reactivarlo.";
    const out = await handlerCmdBotControl(baseCtx({ consulta: "PAUSAR BOT" }));
    print(
      "cmd_bot_control: PAUSAR BOT → manejado",
      out.manejado === true && out.route === "CMD_BOT_CONTROL"
    );
  }

  resetState();
  {
    state.comandoBotOut = null;
    const out = await handlerCmdBotControl(baseCtx({ consulta: "precio soja" }));
    print(
      "cmd_bot_control: precio soja → no match",
      out.manejado === false
    );
  }

  // ===== onboarding =====
  resetState();
  {
    state.onboardingOut = { enOnboarding: true, respuesta: "Bienvenido, ¿cómo te llamás?" };
    const out = await handlerOnboarding(baseCtx({ consulta: "hola" }));
    print(
      "onboarding: usuario en alta → manda mensaje y captura",
      out.manejado === true &&
        out.respuesta === null &&
        out.route === "ONBOARDING_FLOW" &&
        state.sendCalls.length === 1 &&
        /Bienvenido/.test(state.sendCalls[0]) &&
        state.capturaCalls.length === 1 &&
        state.capturaCalls[0].ruta === "onboarding"
    );
  }

  resetState();
  {
    state.onboardingOut = { enOnboarding: true, respuesta: null };
    const out = await handlerOnboarding(baseCtx({ consulta: "..." }));
    print(
      "onboarding: en alta SIN respuesta → manejado, no send",
      out.manejado === true && state.sendCalls.length === 0
    );
  }

  resetState();
  {
    state.onboardingOut = { enOnboarding: false };
    const out = await handlerOnboarding(baseCtx({ consulta: "precio soja" }));
    print("onboarding: no en alta → no match", out.manejado === false);
  }

  resetState();
  {
    state.onboardingOut = { enOnboarding: true, respuesta: "Hola admin" };
    const out = await handlerOnboarding(baseCtx({ consulta: "hola", esAdmin: true }));
    print(
      "onboarding: admin queda EXENTO",
      out.manejado === false && state.sendCalls.length === 0
    );
  }

  // ===== resumen_interactivo =====
  resetState();
  {
    state.estado = { flujo: "resumen_interactivo", whatsapp: "549111" };
    state.resumenManejaCb = async ({ enviar }) => {
      await enviar("Te paso el resumen…");
      return true;
    };
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "si" }));
    print(
      "resumen_interactivo: estado activo + manejado=true → ruta+envío+captura",
      out.manejado === true &&
        out.respuesta === null &&
        out.route === "RESUMEN_INTERACTIVO" &&
        state.sendCalls.length === 1 &&
        /resumen/i.test(state.sendCalls[0]) &&
        state.capturaCalls[0]?.ruta === "resumen_interactivo"
    );
  }

  resetState();
  {
    state.estado = null;
    state.estadoPorUsuario = { flujo: "resumen_interactivo", whatsapp: "549888" };
    state.resumenManejaCb = async () => true;
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "si" }));
    print(
      "resumen_interactivo: fallback por usuario_id → manejado",
      out.manejado === true
    );
  }

  resetState();
  {
    state.estado = { flujo: "otro" };
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "si" }));
    print("resumen_interactivo: flujo distinto → no match", out.manejado === false);
  }

  resetState();
  {
    state.estado = { flujo: "resumen_interactivo" };
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "QUIERO PLAN PRO" }));
    print(
      "resumen_interactivo: comando prioridad cede turno",
      out.manejado === false
    );
  }

  resetState();
  {
    state.estado = { flujo: "resumen_interactivo" };
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "test@dom.com" }));
    print(
      "resumen_interactivo: email solo cede turno",
      out.manejado === false
    );
  }

  resetState();
  {
    state.estado = { flujo: "resumen_interactivo" };
    state.resumenManejaCb = async () => false;
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "ya pasó" }));
    print(
      "resumen_interactivo: handler interno devolvió false → no match",
      out.manejado === false
    );
  }

  resetState();
  {
    state.estado = { flujo: "resumen_interactivo" };
    state.resumenManejaCb = async () => true;
    const out = await handlerResumenInteractivo(baseCtx({ consulta: "si", esAdmin: true }));
    print(
      "resumen_interactivo: admin queda exento",
      out.manejado === false
    );
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error("[handler stateful] error:", e?.message || e, e?.stack);
  process.exit(2);
});
