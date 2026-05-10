#!/usr/bin/env node
"use strict";

/**
 * Prueba end-to-end del flujo WhatsApp para ganado múltiple en una frase:
 * 1) mensaje libre ("...10 vacas blancas y 12 negras...")
 * 2) confirmación "SI"
 * 3) verificación de saldos de inventario
 *
 * Uso:
 *   node scripts/tools/inventario-prueba-whatsapp-ganado-multiple.js
 *   INV_TEST_USUARIO_ID=123 node scripts/tools/inventario-prueba-whatsapp-ganado-multiple.js
 */

require("dotenv").config();

const { query, pool } = require("../../src/config/database");
const { manejarInventarioWhatsapp } = require("../../src/services/inventario/whatsapp_flow");
const { listarSaldos, resolverLotePorNombre, crearLoteUsuario } = require("../../src/services/inventario/core");

async function resolverUsuarioId() {
  const raw = process.env.INV_TEST_USUARIO_ID;
  if (raw != null && String(raw).trim() !== "") {
    const id = Number(String(raw).trim());
    if (!Number.isFinite(id)) throw new Error("INV_TEST_USUARIO_ID debe ser numérico.");
    const ok = await query("SELECT id FROM usuarios WHERE id = $1 LIMIT 1", [id]);
    if (!ok.rows.length) throw new Error(`No existe usuario id=${id}`);
    return id;
  }
  const r = await query("SELECT id FROM usuarios ORDER BY id ASC LIMIT 1");
  if (!r.rows.length) throw new Error("No hay usuarios en la base.");
  return Number(r.rows[0].id);
}

async function asegurarLoteCinco(usuarioId) {
  const ya = await resolverLotePorNombre(usuarioId, "5");
  if (ya?.id) return ya;
  return crearLoteUsuario({ usuarioId, nombre: "5" });
}

function extraerInventarioNumerico(saldos, categoriaRegex) {
  const row = (saldos || []).find(
    (s) => s.dominio === "ganado" && categoriaRegex.test(String(s.etiqueta || s.item_clave || ""))
  );
  return row ? Number(row.cantidad) : null;
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("Falta DATABASE_URL en entorno.");
  }

  const usuarioId = await resolverUsuarioId();
  const lote = await asegurarLoteCinco(usuarioId);

  const numeroWhatsapp = process.env.TEST_WHATSAPP || "5490000000000";
  const mensaje = "Registrar que en el campo 5 meti 10 vacas blancas y 12 negras";

  console.log(`Usuario: ${usuarioId} · Lote: ${lote.nombre} (#${lote.id})`);
  console.log("\n1) Enviando mensaje inicial...");
  const paso1 = await manejarInventarioWhatsapp({ texto: mensaje, usuarioId, numeroWhatsapp });
  console.log("manejado:", paso1.manejado);
  console.log("respuesta:\n", paso1.respuesta || "(sin respuesta)");

  console.log("\n2) Confirmando con SI...");
  const paso2 = await manejarInventarioWhatsapp({ texto: "SI", usuarioId, numeroWhatsapp });
  console.log("manejado:", paso2.manejado);
  console.log("respuesta:\n", paso2.respuesta || "(sin respuesta)");

  console.log("\n3) Verificando saldos...");
  const saldos = await listarSaldos({ usuarioId, loteId: lote.id, dominio: "ganado" });
  const blancas = extraerInventarioNumerico(saldos, /\bvacas?\s+blancas?\b/i);
  const negras = extraerInventarioNumerico(saldos, /\bvacas?\s+negras?\b/i);

  console.log(
    JSON.stringify(
      {
        lote: { id: lote.id, nombre: lote.nombre },
        saldos: saldos
          .filter((s) => s.dominio === "ganado")
          .map((s) => ({ etiqueta: s.etiqueta, cantidad: s.cantidad, unidad: s.unidad })),
        chequeo: {
          esperado: { "vacas blancas": 10, "vacas negras": 12 },
          obtenido: { "vacas blancas": blancas, "vacas negras": negras },
          ok: blancas === 10 && negras === 12,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

