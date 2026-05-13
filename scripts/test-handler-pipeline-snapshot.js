#!/usr/bin/env node
/**
 * Snapshot tests de los handlers terminales:
 * - `inventario_pendiente` (gate de confirmación SI/NO sobre borradores)
 * - `pipeline_agente` (default final de la cadena)
 *
 * Mockea agresivamente: no toca DB ni IA real.
 *
 * Uso: npm run test:handler:pipeline
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const PATHS = {
  consultas: path.join(__dirname, "..", "src", "services", "consultas.js"),
  consultaModel: path.join(__dirname, "..", "src", "models", "consulta.js"),
  usuarioModel: path.join(__dirname, "..", "src", "models", "usuario.js"),
  inventarioCore: path.join(__dirname, "..", "src", "services", "inventario", "core.js"),
  inventarioFlow: path.join(__dirname, "..", "src", "services", "inventario", "whatsapp_flow.js"),
  queueTarea: path.join(__dirname, "..", "src", "services", "agent", "queue", "tarea_fila.js"),
};

const state = {
  pend: null,
  invOut: { manejado: false, respuesta: null },
  procesarOut: "respuesta del pipeline",
  procesarShouldThrow: null,
  encolarShouldThrow: null,
  encolarCalls: [],
  procesarCalls: [],
  guardarCalls: [],
};

require.cache[PATHS.consultas] = {
  id: PATHS.consultas, filename: PATHS.consultas, loaded: true,
  exports: {
    manejarComandoBot: async () => null,
    obtenerEstadoBot: async () => true,
    procesarConsulta: async (whatsapp, consulta, opts) => {
      state.procesarCalls.push({ whatsapp, consulta, opts });
      if (state.procesarShouldThrow) throw state.procesarShouldThrow;
      return state.procesarOut;
    },
  },
};

require.cache[PATHS.consultaModel] = {
  id: PATHS.consultaModel, filename: PATHS.consultaModel, loaded: true,
  exports: {
    guardarConsulta: async (args) => { state.guardarCalls.push(args); },
  },
};

require.cache[PATHS.usuarioModel] = {
  id: PATHS.usuarioModel, filename: PATHS.usuarioModel, loaded: true,
  exports: {
    normalizarWhatsapp: (n) => String(n || "").replace(/\D/g, ""),
  },
};

require.cache[PATHS.inventarioCore] = {
  id: PATHS.inventarioCore, filename: PATHS.inventarioCore, loaded: true,
  exports: {
    obtenerPendiente: async () => state.pend,
  },
};

require.cache[PATHS.inventarioFlow] = {
  id: PATHS.inventarioFlow, filename: PATHS.inventarioFlow, loaded: true,
  exports: {
    manejarInventarioWhatsapp: async () => state.invOut,
  },
};

require.cache[PATHS.queueTarea] = {
  id: PATHS.queueTarea, filename: PATHS.queueTarea, loaded: true,
  exports: {
    encolarConsultaWhatsapp: async (args) => {
      state.encolarCalls.push(args);
      if (state.encolarShouldThrow) throw state.encolarShouldThrow;
      return { id: 1 };
    },
  },
};

Module._cache = require.cache;

const { handlerInventarioPendiente } = require("../src/services/turn_handlers/inventario_pendiente");
const { handlerPipelineAgente } = require("../src/services/turn_handlers/pipeline_agente");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoAlias: "",
  planCtx: { usuario: { id: 7 } },
  flags: { asyncCola: false },
  ...extra,
});

const reset = () => {
  state.pend = null;
  state.invOut = { manejado: false, respuesta: null };
  state.procesarOut = "respuesta del pipeline";
  state.procesarShouldThrow = null;
  state.encolarShouldThrow = null;
  state.encolarCalls.length = 0;
  state.procesarCalls.length = 0;
  state.guardarCalls.length = 0;
};

let ok = 0, fail = 0;
const print = (titulo, passed, det = "") => {
  console.log(`  ${passed ? "✓" : "✗"} ${titulo.padEnd(70)} ${passed ? "" : det}`);
  if (passed) ok += 1; else fail += 1;
};

(async () => {
  // ============ inventario_pendiente ============
  reset();
  {
    state.pend = { id: 1, tipo: "ganado" };
    state.invOut = { manejado: true, respuesta: "✅ Listo, guardado en inventario." };
    const out = await handlerInventarioPendiente(baseCtx({ consulta: "SI" }));
    print(
      "inventario_pendiente: hay borrador + SI → confirma y persiste",
      out.manejado === true &&
        out.route === "registrar_inventario_pendiente" &&
        /guardado/i.test(out.respuesta) &&
        state.guardarCalls.length === 1
    );
  }

  reset();
  {
    state.pend = null;
    const out = await handlerInventarioPendiente(baseCtx({ consulta: "SI" }));
    print(
      "inventario_pendiente: SIN borrador → no match",
      out.manejado === false && state.guardarCalls.length === 0
    );
  }

  reset();
  {
    state.pend = { id: 1 };
    state.invOut = { manejado: false, respuesta: null };
    const out = await handlerInventarioPendiente(baseCtx({ consulta: "tal vez" }));
    /**
     * Nuevo comportamiento (sesión 2026-05-13): si hay borrador
     * pendiente y el flow del inventario no maneja el mensaje, el
     * handler devuelve recordatorio explícito del borrador en vez de
     * ceder turno (antes el LLM respondía cosas como "personas
     * enfermas" al recibir "Dos estaban enfermas").
     */
    print(
      "inventario_pendiente: borrador pero flow no maneja → recordatorio",
      out.manejado === true &&
        out.route === "inventario_pendiente_recordatorio" &&
        /borrador|confirmaci[oó]n|esperando/i.test(out.respuesta || "")
    );
  }
  reset();
  {
    /** Texto que parece de OTRO dominio (precio): handler cede turno. */
    state.invOut = { manejado: false, respuesta: null };
    const out = await handlerInventarioPendiente(baseCtx({ consulta: "precio soja hoy" }));
    print(
      "inventario_pendiente: borrador + consulta de otro dominio → cede turno",
      out.manejado === false
    );
  }

  reset();
  {
    const out = await handlerInventarioPendiente(baseCtx({
      planCtx: { usuario: null },
      consulta: "SI",
    }));
    print(
      "inventario_pendiente: sin usuario → no match",
      out.manejado === false
    );
  }

  // ============ pipeline_agente ============
  reset();
  {
    const out = await handlerPipelineAgente(baseCtx({
      consulta: "precio soja",
      flags: { asyncCola: true },
    }));
    print(
      "pipeline_agente: modo async → encola y respuesta=null",
      out.manejado === true &&
        out.respuesta === null &&
        out.route === "PIPELINE_AGENTE_ENCOLADA" &&
        state.encolarCalls.length === 1 &&
        state.procesarCalls.length === 0
    );
  }

  reset();
  {
    const out = await handlerPipelineAgente(baseCtx({
      consulta: "precio soja",
      flags: { asyncCola: false },
    }));
    print(
      "pipeline_agente: modo sync → procesa y devuelve texto",
      out.manejado === true &&
        out.respuesta === "respuesta del pipeline" &&
        out.route === "PIPELINE_AGENTE_SYNC" &&
        state.procesarCalls.length === 1 &&
        state.encolarCalls.length === 0
    );
  }

  reset();
  state.encolarShouldThrow = new Error("queue full");
  {
    const out = await handlerPipelineAgente(baseCtx({
      consulta: "precio soja",
      flags: { asyncCola: true },
    }));
    print(
      "pipeline_agente: encolar falla → fallback sync",
      out.manejado === true &&
        out.respuesta === "respuesta del pipeline" &&
        out.route === "PIPELINE_AGENTE_SYNC" &&
        state.procesarCalls.length === 1
    );
  }

  reset();
  state.procesarShouldThrow = new Error("kaboom");
  {
    const out = await handlerPipelineAgente(baseCtx({
      consulta: "precio soja",
      flags: { asyncCola: false },
    }));
    print(
      "pipeline_agente: procesarConsulta error → cede turno (manejado:false)",
      out.manejado === false
    );
  }

  reset();
  {
    const out = await handlerPipelineAgente(baseCtx({
      consulta: "",
    }));
    print(
      "pipeline_agente: consulta vacía → no match",
      out.manejado === false
    );
  }

  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error("[handler pipeline] error:", e?.message || e, e?.stack);
  process.exit(2);
});
