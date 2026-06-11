#!/usr/bin/env node
/**
 * Snapshot tests del handler `cmd_flete` (paso B de P2#10).
 *
 * No requiere DB ni IA: mockea `calcularFlete` desde `services/fletes`
 * para validar el formato de la respuesta y la decisión de match/no-match.
 *
 * Uso:
 *   node scripts/test-handler-flete-snapshot.js
 *   npm run test:handler:flete
 */

"use strict";

require("dotenv").config({ override: false });

/**
 * Truquito: mockeamos `calcularFlete` cacheando el módulo en `require.cache`
 * con una versión predecible ANTES de cargar el handler. Eso evita tocar
 * la DB y la API real.
 */
const Module = require("module");
const path = require("path");
const fletesPath = path.join(__dirname, "..", "..", "src", "services", "fletes.js");
require.cache[fletesPath] = {
  id: fletesPath,
  filename: fletesPath,
  loaded: true,
  exports: {
    calcularFlete: async (origen, destino) => {
      if (String(origen).toLowerCase() === "errorland") {
        return { error: "Ruta no encontrada" };
      }
      return {
        distancia_km: 350,
        tarifa_usd_km_tn: 0.000123,
        costo_usd_tn: 22.1,
        costo_total_usd: 618.8,
        peajes_ars: 12345,
        gasoil_actual_ars: 1500,
      };
    },
  },
};
Module._cache = require.cache;

const { handlerCmdFlete } = require("../../src/services/turn_handlers/cmd_flete");

const CASOS = [
  {
    titulo: "match: FLETE Tandil A Rosario",
    ctx: { comandoUpper: "FLETE TANDIL A ROSARIO", consulta: "flete tandil a rosario" },
    esperado: { manejado: true, contiene: "📦 Flete TANDIL → ROSARIO", route: "CMD_FLETE" },
  },
  {
    titulo: "match con caso mixto: flete tandil a rosario",
    ctx: { comandoUpper: null, consulta: "flete tandil a rosario" },
    esperado: { manejado: true, contiene: "Costo total (28 tn)", route: "CMD_FLETE" },
  },
  {
    titulo: "no match: precio soja",
    ctx: { comandoUpper: "PRECIO SOJA", consulta: "precio soja" },
    esperado: { manejado: false },
  },
  {
    titulo: "no match: mensaje vacío",
    ctx: { comandoUpper: "", consulta: "" },
    esperado: { manejado: false },
  },
  {
    titulo: "error de cálculo",
    ctx: { comandoUpper: "FLETE ERRORLAND A ROSARIO", consulta: "flete errorland a rosario" },
    esperado: {
      manejado: true,
      contiene: "No pude calcular ese flete: Ruta no encontrada",
      route: "CMD_FLETE",
    },
  },
];

const main = async () => {
  let pasados = 0;
  let fallados = 0;
  const fallos = [];
  for (const c of CASOS) {
    const out = await handlerCmdFlete(c.ctx);
    let ok = true;
    const detalle = [];
    if (c.esperado.manejado !== out.manejado) {
      ok = false;
      detalle.push(`manejado esperado=${c.esperado.manejado} real=${out.manejado}`);
    }
    if (c.esperado.contiene && !String(out.respuesta || "").includes(c.esperado.contiene)) {
      ok = false;
      detalle.push(`respuesta no contiene "${c.esperado.contiene}"`);
    }
    if (c.esperado.route && c.esperado.route !== out.route) {
      ok = false;
      detalle.push(`route esperado=${c.esperado.route} real=${out.route}`);
    }
    if (ok) pasados += 1;
    else {
      fallados += 1;
      fallos.push({ titulo: c.titulo, detalle, out });
    }
    console.log(`  ${ok ? "✓" : "✗"} ${c.titulo.padEnd(46)} ${ok ? "" : detalle.join(" | ")}`);
  }
  console.log(`\nResumen: ${pasados} OK, ${fallados} fallidos.`);
  if (fallados > 0) {
    console.log("\nDetalle de fallos:");
    for (const f of fallos) {
      console.log(`- ${f.titulo}`);
      console.log(`  ${f.detalle.join(" | ")}`);
      console.log(`  respuesta real: ${String(f.out?.respuesta || "").slice(0, 200)}`);
    }
    process.exit(1);
  }
};

main().catch((e) => {
  console.error("[handler flete] error:", e?.message || e);
  process.exit(2);
});
