#!/usr/bin/env node
/**
 * Corrección puntual: la carga del 12/05/2026 ~01:32 a Lote 9 quedó mal por el bug
 * del parser multi-lote (que tomaba el nombre del primer lote y mezclaba cantidades
 * del primer y segundo lote en el mismo mensaje, además de ignorar numerales en
 * español como «un ternero»).
 *
 * El usuario escribió:
 *   «Lote 9 20 vaquillonas y un ternero
 *    Lote 14 4 novillos un toro y una cabra»
 * El bot guardó:
 *   «20 vaquillonas y 4 novillos» en Lote 9
 *
 * Este script:
 *  1) Localiza al usuario por whatsapp.
 *  2) Lista los movimientos confirmados de inventario del 12/05/2026 en Lote 9
 *     (dry-run por defecto).
 *  3) Con --apply marca como 'rechazado' los movimientos que ese día cargaron
 *     `novillos` en Lote 9 (categoría que el usuario NO mencionó para ese lote).
 *  4) Re-deriva el saldo de Lote 9 desde los movimientos confirmados restantes
 *     (truncando a 0 si no quedan datos para esa clave de ítem).
 *
 * Uso:
 *   AGRO_WHATSAPP=5492494... node scripts/correcciones/fix-multilote-lote9-2026-05-12.js
 *   AGRO_WHATSAPP=5492494... node scripts/correcciones/fix-multilote-lote9-2026-05-12.js --apply
 */

require("dotenv").config();
const { query } = require("../../src/config/database");

const FECHA_INCIDENTE = "2026-05-12";
const LOTE_OBJETIVO = "9";

const apply = process.argv.includes("--apply");

async function buscarUsuario(waDigits) {
  const r = await query(
    `
      SELECT id, nombre, whatsapp, whatsapp_real
      FROM usuarios
      WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(whatsapp_jid, ''), '\\D', '', 'g') = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [waDigits]
  );
  return r.rows[0] || null;
}

async function buscarLote9(usuarioId) {
  const r = await query(
    `
      SELECT id, nombre, hectareas
      FROM lotes
      WHERE usuario_id = $1
        AND (lower(nombre) = lower($2) OR lower(nombre) = lower($3))
      ORDER BY id ASC
      LIMIT 1
    `,
    [usuarioId, LOTE_OBJETIVO, `Lote ${LOTE_OBJETIVO}`]
  );
  return r.rows[0] || null;
}

async function listarMovimientosDelIncidente(usuarioId, loteId) {
  const r = await query(
    `
      SELECT id, dominio, clase, efecto, payload, estado, fecha_referencia, creado_en, confirmado_en
      FROM inventario_movimiento
      WHERE usuario_id = $1
        AND lote_id = $2
        AND fecha_referencia = $3::date
      ORDER BY id ASC
    `,
    [usuarioId, loteId, FECHA_INCIDENTE]
  );
  return r.rows || [];
}

function categoriasDelPayload(payload) {
  const p = typeof payload === "object" && payload ? payload : {};
  const cats = [];
  if (p?.categoria) cats.push(String(p.categoria));
  if (Array.isArray(p?.items)) {
    for (const it of p.items) {
      if (it?.categoria) cats.push(String(it.categoria));
    }
  }
  if (Array.isArray(p?.items_compuestos)) {
    for (const it of p.items_compuestos) {
      if (it?.payload?.categoria) cats.push(String(it.payload.categoria));
      if (Array.isArray(it?.payload?.items)) {
        for (const sub of it.payload.items) {
          if (sub?.categoria) cats.push(String(sub.categoria));
        }
      }
    }
  }
  return cats;
}

function pareceMovimientoIncorrectoNovillosLote9(mov) {
  const cats = categoriasDelPayload(mov.payload).map((s) => s.toLowerCase().trim());
  return cats.some((c) => c === "novillos" || c === "novillo");
}

async function rechazarMovimiento(id, usuarioId) {
  const r = await query(
    `
      UPDATE inventario_movimiento
      SET estado = 'rechazado',
          rechazado_en = COALESCE(rechazado_en, NOW())
      WHERE id = $1 AND usuario_id = $2
      RETURNING id, estado
    `,
    [id, usuarioId]
  );
  return r.rows[0] || null;
}

async function rederivarSaldoLote9Novillos(usuarioId, loteId) {
  /**
   * Asumimos que el item_clave del saldo es `g:vacuno:novillos` (slug normalizado).
   * Si NO quedan movimientos confirmados con `novillos` en este lote, eliminamos el saldo.
   */
  const item = "g:vacuno:novillos";
  const restantes = await query(
    `
      SELECT COUNT(*)::int AS n
      FROM inventario_movimiento
      WHERE usuario_id = $1
        AND lote_id = $2
        AND estado = 'confirmado'
        AND (
          lower(payload->>'categoria') IN ('novillo','novillos')
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) it
            WHERE lower(it->>'categoria') IN ('novillo','novillos')
          )
        )
    `,
    [usuarioId, loteId]
  );
  if ((restantes.rows[0]?.n || 0) > 0) {
    console.log(
      `  [saldo] Quedan ${restantes.rows[0].n} movimientos confirmados con novillos en Lote 9: NO toco el saldo (revisalo a mano si hace falta).`
    );
    return;
  }
  const del = await query(
    `
      DELETE FROM inventario_saldo
      WHERE usuario_id = $1
        AND dominio = 'ganado'
        AND item_clave = $2
        AND lote_id = $3
      RETURNING id
    `,
    [usuarioId, item, loteId]
  );
  console.log(
    `  [saldo] Filas eliminadas en inventario_saldo (Lote 9 / novillos): ${del.rowCount || 0}`
  );
}

async function main() {
  const waEnv = String(process.env.AGRO_WHATSAPP || "").replace(/\D/g, "");
  if (!waEnv) {
    console.error("Definí AGRO_WHATSAPP con tu número (solo dígitos).");
    process.exit(1);
  }

  const usuario = await buscarUsuario(waEnv);
  if (!usuario) {
    console.error(`No encontré usuario con whatsapp=${waEnv}.`);
    process.exit(1);
  }
  console.log(`Usuario: id=${usuario.id} nombre=${usuario.nombre || "(s/n)"}`);

  const lote = await buscarLote9(usuario.id);
  if (!lote) {
    console.error(`Usuario ${usuario.id} no tiene un lote llamado "9" / "Lote 9". Nada para corregir.`);
    process.exit(0);
  }
  console.log(`Lote: id=${lote.id} nombre=${lote.nombre}`);

  const movs = await listarMovimientosDelIncidente(usuario.id, lote.id);
  if (!movs.length) {
    console.log(`No hay movimientos en Lote ${lote.nombre} con fecha_referencia=${FECHA_INCIDENTE}.`);
    process.exit(0);
  }

  console.log(
    `\nMovimientos de Lote ${lote.nombre} con fecha_referencia=${FECHA_INCIDENTE}:`
  );
  const aRechazar = [];
  for (const m of movs) {
    const cats = categoriasDelPayload(m.payload).join(", ") || "(sin categoría)";
    const mark = pareceMovimientoIncorrectoNovillosLote9(m) ? "❌" : "  ";
    console.log(
      `  ${mark} mov#${m.id} estado=${m.estado} efecto=${m.efecto} cat=[${cats}] creado_en=${m.creado_en?.toISOString?.() || m.creado_en}`
    );
    if (
      m.estado === "confirmado" &&
      pareceMovimientoIncorrectoNovillosLote9(m)
    ) {
      aRechazar.push(m);
    }
  }

  if (!aRechazar.length) {
    console.log("\nNo encuentro movimientos confirmados con `novillos` en Lote 9. Nada para corregir.");
    process.exit(0);
  }

  console.log(`\n${aRechazar.length} movimiento(s) candidato(s) a corregir (marcados ❌).`);
  if (!apply) {
    console.log("\n[DRY-RUN] Pasá --apply para aplicar las correcciones.");
    process.exit(0);
  }

  for (const m of aRechazar) {
    const r = await rechazarMovimiento(m.id, usuario.id);
    console.log(`  ✓ mov#${m.id} -> ${r?.estado}`);
  }
  await rederivarSaldoLote9Novillos(usuario.id, lote.id);
  console.log("\nCorrección aplicada. Verificá con tu app o «MI INVENTARIO» en WhatsApp.");
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exit(1);
  })
  .finally(() => process.exit(0));
