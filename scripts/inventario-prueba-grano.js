#!/usr/bin/env node
/**
 * Inserta dos movimientos de inventario dominio «grano» (replace + delta)
 * usando el mismo código que POST /api/inventario/registro (registroConfirmadoDirecto)
 * y lista saldos y últimos movimientos.
 *
 * Uso:
 *   node scripts/inventario-prueba-grano.js
 *   INV_TEST_USUARIO_ID=123 node scripts/inventario-prueba-grano.js
 *
 * Requiere: DATABASE_URL, migraciones inventario aplicadas (incl. dominio grano).
 */
"use strict";

require("dotenv").config();

const { pool, query } = require("../src/config/database");
const { registroConfirmadoDirecto, listarSaldos, listarMovimientos } = require("../src/services/inventario/core");

async function resolverUsuarioId() {
  const raw = process.env.INV_TEST_USUARIO_ID;
  if (raw != null && String(raw).trim() !== "") {
    const id = Number(String(raw).trim());
    if (!Number.isFinite(id)) throw new Error("INV_TEST_USUARIO_ID debe ser numérico");
    const ok = await query(`SELECT id FROM usuarios WHERE id = $1 LIMIT 1`, [id]);
    if (!ok.rows.length) throw new Error(`No existe usuario id=${id}`);
    return id;
  }
  const r = await query(`SELECT id FROM usuarios ORDER BY id ASC LIMIT 1`);
  if (!r.rows.length) throw new Error("No hay usuarios en la base; cargá INV_TEST_USUARIO_ID después de tener datos.");
  const id = r.rows[0].id;
  console.warn(`INV_TEST_USUARIO_ID no definido; usando primer usuario id=${id}`);
  return id;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("Falta DATABASE_URL en entorno (.env)");
    process.exit(1);
  }

  const usuarioId = await resolverUsuarioId();
  const tag = Date.now();

  console.log("\n→ Registro REPLACE grano (100 tn Soja)…");
  const m1 = await registroConfirmadoDirecto({
    usuarioId,
    dominio: "grano",
    efecto: "replace",
    payload: { cultivo: "Soja", toneladas: 100 },
    fechaReferencia: undefined,
    canal: "script",
    textoNl: `[prueba grano replace ${tag}]`,
    idempotencyKey: `script-grano-rpl-${tag}`,
  });
  console.log("  Movimiento id:", m1.id);

  console.log("\n→ Registro DELTA grano (−25 tn Soja)…");
  const m2 = await registroConfirmadoDirecto({
    usuarioId,
    dominio: "grano",
    efecto: "delta",
    payload: { cultivo: "Soja", delta: -25 },
    canal: "script",
    textoNl: `[prueba grano delta ${tag}]`,
    idempotencyKey: `script-grano-dlt-${tag}`,
  });
  console.log("  Movimiento id:", m2.id);

  const saldos = await listarSaldos({ usuarioId, dominio: "grano" });
  const movs = await listarMovimientos({ usuarioId, limit: 15 });

  console.log("\n=== Saldos dominio «grano» (usuario %s) ===", usuarioId);
  console.log(JSON.stringify(saldos, null, 2));

  console.log("\n=== Últimos movimientos (incluye joins lote/campaña) ===");
  const recientes = (movs || []).filter((x) => String(x.texto_nl || "").includes(`prueba grano`) || x.id === m1.id || x.id === m2.id);
  console.log(JSON.stringify(recientes.length ? recientes : movs.slice(0, 5), null, 2));

  const saldoSoja = saldos.find((s) => /soja/i.test(String(s.etiqueta || "")));
  const esperado = 75;
  const ok =
    saldoSoja &&
    Number(saldoSoja.cantidad) === esperado &&
    saldoSoja.unidad === "tn";
  console.log("\n=== Chequeo esperado (100 − 25 = 75 tn) ===");
  console.log(ok ? "OK" : "Revisar manualmente", saldoSoja ? { cantidad: saldoSoja.cantidad, unidad: saldoSoja.unidad } : "(sin fila Soja)");
}

main()
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  })
  .finally(() => pool.end());
