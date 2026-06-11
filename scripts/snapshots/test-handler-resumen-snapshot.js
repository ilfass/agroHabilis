#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_resumen` (paso C de P2#10).
 *
 * Mockea dependencias pesadas (DB de usuarios, modelo de consultas y el
 * flujo de resumen interactivo) vía `require.cache` para validar solo el
 * matching + decisiones del handler.
 *
 * Uso:
 *   npm run test:handler:resumen
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const usuarioPath = path.join(__dirname, "..", "..", "src", "models", "usuario.js");
const consultaPath = path.join(__dirname, "..", "..", "src", "models", "consulta.js");
const resumenIntPath = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "resumen_interactivo.js"
);

const state = {
  usuarioPorJid: null,
  iniciarResumenOut: { omitido: false },
  enviados: [],
  guardado: null,
};

require.cache[usuarioPath] = {
  id: usuarioPath,
  filename: usuarioPath,
  loaded: true,
  exports: {
    buscarPorWhatsapp: async () => state.usuarioPorJid,
    normalizarWhatsapp: (s) => String(s || "").replace(/\D/g, ""),
    destinoWhatsappParaEnvio: (u) => u?.whatsapp || "",
  },
};
require.cache[consultaPath] = {
  id: consultaPath,
  filename: consultaPath,
  loaded: true,
  exports: {
    guardarConsulta: async (row) => {
      state.guardado = row;
    },
  },
};
require.cache[resumenIntPath] = {
  id: resumenIntPath,
  filename: resumenIntPath,
  loaded: true,
  exports: {
    iniciarResumen: async (usuario, opts) => {
      if (opts?.enviar) opts.enviar("MOCK invitación enviada");
      return state.iniciarResumenOut;
    },
  },
};
Module._cache = require.cache;

const { handlerCmdResumen } = require("../../src/services/turn_handlers/cmd_resumen");

const baseCtx = () => ({
  jid: "549111@c.us",
  consulta: "mi resumen",
  comandoUpper: "MI RESUMEN",
  comandoAlias: "MI RESUMEN",
  comandoNatural: null,
  send: (t) => state.enviados.push(t),
});

const CASOS = [
  {
    titulo: "no match: alias distinto",
    setup: () => {
      state.usuarioPorJid = { id: 1 };
    },
    ctx: { ...baseCtx(), comandoAlias: "FLETE", comandoNatural: null },
    esperado: { manejado: false },
  },
  {
    titulo: "sin usuario (debe pedir onboarding)",
    setup: () => {
      state.usuarioPorJid = null;
      state.enviados.length = 0;
      state.guardado = null;
    },
    ctx: baseCtx(),
    esperado: {
      manejado: true,
      route: "CMD_MI_RESUMEN",
      contiene: "completar tu perfil",
      enviados: 0,
      guardado: false,
    },
  },
  {
    titulo: "omitido (otro flujo activo)",
    setup: () => {
      state.usuarioPorJid = { id: 1 };
      state.iniciarResumenOut = { omitido: true };
      state.enviados.length = 0;
      state.guardado = null;
    },
    ctx: baseCtx(),
    esperado: {
      manejado: true,
      route: "CMD_MI_RESUMEN",
      contiene: "Terminá primero",
      guardado: false,
    },
  },
  {
    titulo: "flujo OK: invitación enviada, respuesta=null, historial guardado",
    setup: () => {
      state.usuarioPorJid = { id: 1 };
      state.iniciarResumenOut = { omitido: false };
      state.enviados.length = 0;
      state.guardado = null;
    },
    ctx: baseCtx(),
    esperado: {
      manejado: true,
      respuestaNull: true,
      route: "CMD_MI_RESUMEN",
      enviados: 1,
      guardado: true,
    },
  },
  {
    titulo: "match por comandoNatural en lugar de alias",
    setup: () => {
      state.usuarioPorJid = { id: 1 };
      state.iniciarResumenOut = { omitido: false };
      state.enviados.length = 0;
      state.guardado = null;
    },
    ctx: { ...baseCtx(), comandoAlias: null, comandoNatural: "MI RESUMEN" },
    esperado: { manejado: true, respuestaNull: true, route: "CMD_MI_RESUMEN" },
  },
];

const main = async () => {
  let ok = 0, fail = 0;
  const fallos = [];
  for (const c of CASOS) {
    c.setup?.();
    const out = await handlerCmdResumen(c.ctx);
    const det = [];
    if (c.esperado.manejado !== out.manejado) det.push(`manejado esperado=${c.esperado.manejado} real=${out.manejado}`);
    if (c.esperado.route && c.esperado.route !== out.route) det.push(`route ${c.esperado.route} vs ${out.route}`);
    if (c.esperado.contiene && !String(out.respuesta || "").includes(c.esperado.contiene))
      det.push(`respuesta no contiene "${c.esperado.contiene}"`);
    if (c.esperado.respuestaNull && out.respuesta != null)
      det.push(`esperaba respuesta=null, real=${JSON.stringify(out.respuesta)}`);
    if (c.esperado.enviados != null && state.enviados.length !== c.esperado.enviados)
      det.push(`enviados esperado=${c.esperado.enviados} real=${state.enviados.length}`);
    if (c.esperado.guardado === true && !state.guardado) det.push("esperaba guardar historial");
    if (c.esperado.guardado === false && state.guardado) det.push("no debía guardar historial");
    const aprueba = det.length === 0;
    if (aprueba) ok += 1;
    else {
      fail += 1;
      fallos.push({ titulo: c.titulo, det, out });
    }
    console.log(`  ${aprueba ? "✓" : "✗"} ${c.titulo.padEnd(60)} ${aprueba ? "" : det.join(" | ")}`);
  }
  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) {
    for (const f of fallos) console.log("- ", f.titulo, "→", f.det);
    process.exit(1);
  }
};

main().catch((e) => {
  console.error("[handler resumen] error:", e?.message || e);
  process.exit(2);
});
