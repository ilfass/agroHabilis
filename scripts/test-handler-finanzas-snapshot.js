#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_finanzas` (paso E de P2#10).
 * Mockea `services/gastos`, `services/planes` y deja `whatsapp_intents`
 * real (las heurísticas que usa son puras, sin DB).
 *
 * Uso: npm run test:handler:finanzas
 */

"use strict";

require("dotenv").config({ override: false });

const Module = require("module");
const path = require("path");

const gastosPath = path.join(__dirname, "..", "src", "services", "gastos.js");
const planesPath = path.join(__dirname, "..", "src", "services", "planes.js");

const state = {
  planActivo: true,
  gastoLast: null,
  ventaLast: null,
};

require.cache[gastosPath] = {
  id: gastosPath,
  filename: gastosPath,
  loaded: true,
  exports: {
    registrarGasto: async (_jid, c) => {
      state.gastoLast = c;
      return "[mock] gasto OK";
    },
    registrarVenta: async (_jid, c) => {
      state.ventaLast = c;
      return "[mock] venta OK";
    },
    obtenerTextoMisGastos: async () => "[mock] tus gastos",
    obtenerTextoMisVentas: async () => "[mock] tus ventas",
    obtenerTextoMiMargen: async () => "[mock] tu margen",
  },
};
require.cache[planesPath] = {
  id: planesPath,
  filename: planesPath,
  loaded: true,
  exports: { puedeUsarFinanzas: () => state.planActivo },
};
Module._cache = require.cache;

const { handlerCmdFinanzas } = require("../src/services/turn_handlers/cmd_finanzas");

const baseCtx = (extra) => ({
  jid: "549111@c.us",
  consulta: "",
  comandoAlias: "",
  comandoNatural: "",
  planCtx: { planEfectivo: "pro" },
  ...extra,
});

const CASOS = [
  {
    titulo: "GASTÉ 5000 con plan",
    pre: () => { state.planActivo = true; state.gastoLast = null; },
    ctx: baseCtx({ comandoAlias: "GASTÉ 5000 EN GASOIL", consulta: "gasté 5000 en gasoil" }),
    esperado: { manejado: true, route: "CMD_GASTO", contiene: "gasto OK" },
    check: () => state.gastoLast?.includes("gasoil"),
  },
  {
    titulo: "COMPRÉ semilla sin plan → upsell",
    pre: () => { state.planActivo = false; },
    ctx: baseCtx({ comandoAlias: "COMPRÉ 80 KG SEMILLA", consulta: "compré 80 kg semilla" }),
    esperado: { manejado: true, route: "CMD_GASTO", contiene: "Plan Pro" },
  },
  {
    titulo: "VENDÍ 30 tn soja con plan",
    pre: () => { state.planActivo = true; state.ventaLast = null; },
    ctx: baseCtx({ comandoAlias: "VENDÍ 30 TN SOJA A 440000", consulta: "vendí 30 tn soja a 440000" }),
    esperado: { manejado: true, route: "CMD_VENTA", contiene: "venta OK" },
  },
  {
    titulo: "VENDÍ pero es consulta de mercado → NO debe matchear",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoAlias: "VENDI SOJA", consulta: "me conviene vender soja hoy" }),
    esperado: { manejado: false },
  },
  {
    titulo: "MIS GASTOS con plan",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoAlias: "MIS GASTOS" }),
    esperado: { manejado: true, route: "CMD_MIS_GASTOS", contiene: "tus gastos" },
  },
  {
    titulo: "MIS VENTAS sin plan",
    pre: () => { state.planActivo = false; },
    ctx: baseCtx({ comandoAlias: "MIS VENTAS" }),
    esperado: { manejado: true, route: "CMD_MIS_VENTAS", contiene: "Plan Pro" },
  },
  {
    titulo: "MI MARGEN con plan",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoAlias: "MI MARGEN" }),
    esperado: { manejado: true, route: "CMD_MI_MARGEN", contiene: "tu margen" },
  },
  {
    titulo: "MI MARGEN natural (sin alias)",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoNatural: "MI MARGEN" }),
    esperado: { manejado: true, route: "CMD_MI_MARGEN" },
  },
  {
    titulo: "no match: FLETE",
    pre: () => { state.planActivo = true; },
    ctx: baseCtx({ comandoAlias: "FLETE TANDIL A ROSARIO" }),
    esperado: { manejado: false },
  },
];

const main = async () => {
  let ok = 0, fail = 0;
  for (const c of CASOS) {
    c.pre?.();
    const out = await handlerCmdFinanzas(c.ctx);
    const det = [];
    if (out.manejado !== c.esperado.manejado) det.push(`manejado ${out.manejado} vs ${c.esperado.manejado}`);
    if (c.esperado.route && out.route !== c.esperado.route) det.push(`route ${out.route} vs ${c.esperado.route}`);
    if (c.esperado.contiene && !String(out.respuesta || "").includes(c.esperado.contiene))
      det.push(`respuesta no contiene "${c.esperado.contiene}"`);
    if (c.check && !c.check()) det.push("side-effect falló");
    const passes = det.length === 0;
    if (passes) ok += 1; else fail += 1;
    console.log(`  ${passes ? "✓" : "✗"} ${c.titulo.padEnd(60)} ${passes ? "" : det.join(" | ")}`);
  }
  console.log(`\nResumen: ${ok} OK, ${fail} fallidos.`);
  if (fail) process.exit(1);
};

main().catch((e) => { console.error("[handler finanzas] error:", e?.message || e); process.exit(2); });
