#!/usr/bin/env node
/**
 * Inserta en historial_consultas el texto del masivo largo ya enviado (una fila por usuario),
 * para que el bot interprete las respuestas como feedback a esa campaña.
 * No modela un “segundo masivo”: si hubo un recordatorio corto aparte, no hace falta duplicarlo en historial.
 *
 * Uso:
 *   node scripts/backfill-broadcast-historial.js --dry-run
 *   node scripts/backfill-broadcast-historial.js
 *   node scripts/backfill-broadcast-historial.js --desde=2026-05-09 --hasta=2026-05-11
 *
 * La primera ejecución real con batch nuevo borra filas del backfill anterior de dos plantillas
 * (lote `20260509-masivos`) y reemplaza por una sola fila por usuario con texto TEMPLATE_CAMPAÑA.
 */
require("dotenv").config();
const { query, pool } = require("../src/config/database");
const { normalizarWhatsapp } = require("../src/models/usuario");
const { interpolarMensajeMasivo } = require("../src/utils/interpolar_mensaje_masivo");
const { PREGUNTA_MARCADOR_BROADCAST } = require("../src/services/broadcast_historial");

const BACKFILL_BATCH_V1_DOS_PLANTILLAS = "20260509-masivos";
const BACKFILL_BATCH = "20260509-campaña-sola";

/** Texto largo del masivo (editá si cambió la campaña). */
const TEMPLATE_CAMPAÑA = `Hola {{nombre}}

Te escribo porque sos de los primeros en probar esta herramienta y tu feedback para nosotros es oro puro. Queremos que el bot sea realmente útil en tu día a día, y por eso me encantaría saber:


¿Qué más le preguntarías? Recordá que podés consultarle por el mercado (precios, dólar) o el clima de tu zona en lenguaje simple.


¿Te serviría cargar tus propios datos? Estamos pensando en que puedas registrar tus labores o costos para después consultarlos por acá mismo.


¿Qué le falta para que sea tu herramienta de cabecera en el lote?

Si tenés un minuto, respondeme por acá mismo. ¡Nos ayuda un montón a seguir mejorando! Gracias`;

const argVal = (name) => {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
};

const dryRun = process.argv.includes("--dry-run");

const desde = argVal("--desde") || "2026-05-09";
const hasta = argVal("--hasta") || "2026-05-11";

async function contarBackfill(usuarioId) {
  const r = await query(
    `
      SELECT COUNT(*)::int AS n
      FROM historial_consultas
      WHERE usuario_id = $1
        AND ia_provider = 'broadcast_admin'
        AND COALESCE(ia_provider_trace->>'backfill_batch', '') = $2
    `,
    [usuarioId, BACKFILL_BATCH]
  );
  return r.rows[0]?.n || 0;
}

async function insertarFila({ usuarioId, whatsapp, respuesta, creadoEn }) {
  const trace = JSON.stringify({
    origen: "broadcast_admin",
    backfill_batch: BACKFILL_BATCH,
  });
  await query(
    `
      INSERT INTO historial_consultas (
        usuario_id, whatsapp, pregunta, respuesta,
        tokens_usados, ia_sin_contexto, ia_provider, ia_provider_trace, creado_en
      )
      VALUES ($1, $2, $3, $4, NULL, NULL, 'broadcast_admin', $5::jsonb, $6::timestamptz)
    `,
    [usuarioId, whatsapp, PREGUNTA_MARCADOR_BROADCAST, respuesta, trace, creadoEn]
  );
}

async function main() {
  const r = await query(
    `
      SELECT DISTINCT ON (e.usuario_id)
        e.id, e.usuario_id, e.creado_en,
        u.nombre, u.whatsapp, u.whatsapp_real
      FROM envios_whatsapp e
      JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.resumen_id IS NULL
        AND e.estado = 'ok'
        AND e.creado_en >= $1::date
        AND e.creado_en < $2::date
      ORDER BY e.usuario_id ASC, e.creado_en ASC
    `,
    [desde, hasta]
  );

  if (!dryRun) {
    const del = await query(
      `
        DELETE FROM historial_consultas
        WHERE ia_provider = 'broadcast_admin'
          AND ia_provider_trace->>'backfill_batch' = $1
        RETURNING id
      `,
      [BACKFILL_BATCH_V1_DOS_PLANTILLAS]
    );
    const nDel = del.rowCount ?? 0;
    if (nDel > 0) {
      console.log(
        `[backfill-broadcast-historial] eliminadas ${nDel} fila(s) del lote antiguo ${BACKFILL_BATCH_V1_DOS_PLANTILLAS}`
      );
    }
  }

  let ok = 0;
  let skip = 0;
  for (const row of r.rows) {
    const usuarioId = row.usuario_id;
    const ya = await contarBackfill(usuarioId);
    if (ya >= 1) {
      skip += 1;
      continue;
    }
    const u = {
      nombre: row.nombre,
      whatsapp: row.whatsapp,
      whatsapp_real: row.whatsapp_real,
    };
    const wa =
      normalizarWhatsapp(String(u.whatsapp_real || u.whatsapp || "")) ||
      normalizarWhatsapp(String(u.whatsapp || ""));
    if (!wa) {
      console.warn("[backfill] sin whatsapp usuario_id=", usuarioId);
      skip += 1;
      continue;
    }

    const texto = interpolarMensajeMasivo(TEMPLATE_CAMPAÑA, u);

    if (dryRun) {
      console.log(
        `[dry-run] usuario_id=${usuarioId} creado_en=${row.creado_en} insertar=1`
      );
      ok += 1;
      continue;
    }

    await insertarFila({
      usuarioId,
      whatsapp: wa,
      respuesta: texto,
      creadoEn: row.creado_en,
    });
    ok += 1;
  }

  console.log(
    `[backfill-broadcast-historial] rango ${desde} .. ${hasta} batch=${BACKFILL_BATCH} dryRun=${dryRun} usuarios_insertados=${ok} omitidos_ya_hechos_o_sin_wa=${skip} usuarios_con_primer_envio=${r.rows.length}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
