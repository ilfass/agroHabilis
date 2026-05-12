#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_alertas` (paso D de P2#10).
 *
 * Mockea `services/alertas` y `services/planes` para validar matching
 * y branching sin tocar DB.
 *
 * Uso: npm run test:handler:alertas
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const alertasPath = path.join(__dirname, "..", "src", "services", "alertas.js");
const planesPath = path.join(__dirname, "..", "src", "services", "planes.js");

const state = {
  planActivo: true,
  cancelOutId: null,
  configurarLast: null,
};

require.cache[alertasPath] = {
  id: alertasPath,
  filename: alertasPath,
  loaded: true,
  exports: {
    listarAlertas: async () => "[mock] tus alertas",
    cancelarAlerta: async (_jid, id) => {
      state.cancelOutId = id;
      return `[mock] alerta ${id} cancelada`;
    },
    configurarAlerta: async (_jid, consulta) => {
      state.configurarLast = consulta;
      return "[mock] alerta configurada";
    },
  },
};
require.cache[planesPath] = {
  id: planesPath,
  filename: planesPath,
  loaded: true,
  exports: {
    puedeUsarAlertas: () => state.planActivo,
  },
};
Module._cache = require.cache;

const { handlerCmdAlertas } = require("../src/services/turn_handlers/cmd_alertas");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoUpper: "",
  comandoAlias: "",
  comandoNatural: "",
  planCtx: { planEfectivo: "basico" },
  ...extra,
});

const CASOS = [
  {
    titulo: "MIS ALERTAS con plan",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoAlias: "MIS ALERTAS" }),
    esperado: { manejado: true, route: "CMD_MIS_ALERTAS", contiene: "tus alertas" },
  },
  {
    titulo: "MIS ALERTAS sin plan → upsell",
    pre: () => { state.planActivo = false; },
    ctx: baseCtx({ comandoAlias: "MIS ALERTAS" }),
    esperado: { manejado: true, contiene: "Plan Básico" },
  },
  {
    titulo: "CANCELAR ALERTA 42 con plan",
    pre: () => { state.planActivo = true; state.cancelOutId = null; },
    ctx: baseCtx({ comandoAlias: "CANCELAR ALERTA 42", consulta: "cancelar alerta 42" }),
    esperado: { manejado: true, route: "CMD_CANCELAR_ALERTA" },
    check: () => state.cancelOutId === "42",
  },
  {
    titulo: "ALERTA soja 440000 con plan",
    pre: () => { state.planActivo = true; state.configurarLast = null; },
    ctx: baseCtx({ comandoAlias: "ALERTA SOJA 440000", consulta: "alerta soja cuando supere 440000" }),
    esperado: { manejado: true, route: "CMD_ALERTA" },
    check: () => /soja/i.test(state.configurarLast || ""),
  },
  {
    titulo: "AVISAME cuando baje sin plan",
    pre: () => { state.planActivo = false; },
    ctx: baseCtx({ comandoAlias: "AVISAME CUANDO BAJE", consulta: "avisame cuando baje" }),
    esperado: { manejado: true, contiene: "Plan Básico" },
  },
  {
    titulo: "__ALERTA__ natural con plan",
    pre: () => { state.planActivo = true; state.configurarLast = null; },
    ctx: baseCtx({ comandoNatural: "__ALERTA__", consulta: "quiero que me avises si la soja supera 440k" }),
    esperado: { manejado: true, route: "CMDN_ALERTA_NATURAL" },
    check: () => state.configurarLast != null,
  },
  {
    titulo: "no match",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoAlias: "MI PLAN" }),
    esperado: { manejado: false },
  },
];

const main = async () => {
  let ok = 0, fail = 0;
  for (const c of CASOS) {
    c.pre?.();
    const out = await handlerCmdAlertas(c.ctx);
    const det = [];
    if (out.manejado !== c.esperado.manejado) det.push(`manejado ${out.manejado} vs ${c.esperado.manejado}`);
    if (c.esperado.route && out.route !== c.esperado.route) det.push(`route ${out.route} vs ${c.esperado.route}`);
    if (c.esperado.contiene && !String(out.respuesta || "").includes(c.esperado.contiene))
      det.push(`respuesta no contiene "${c.esperado.contiene}"`);
    if (c.check && !c.check()) det.push("check side-effect falló");
    const passes = det.length === 0;
    if (passes) ok += 1; else fail += 1;
    console.log(`  ${passes ? "✓" : "✗"} ${c.titulo.padEnd(48)} ${passes ? "" : det.join(" | ")}`);
  }
  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
};

main().catch((e) => {
  console.error("[handler alertas] error:", e?.message || e);
  process.exit(2);
});
