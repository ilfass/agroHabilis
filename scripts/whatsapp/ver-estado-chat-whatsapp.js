#!/usr/bin/env node
/**
 * Resumen de en qué quedó el “chat” de un número (BD): usuario, onboarding, bot, historial.
 *
 * Uso: node scripts/whatsapp/ver-estado-chat-whatsapp.js 5492494308376
 *      WHATSAPP_VER=549... node scripts/whatsapp/ver-estado-chat-whatsapp.js
 */
require("dotenv").config();
const path = require("path");
const { query, pool } = require(path.join(__dirname, "..", "..", "src", "config", "database"));

const waArg =
  process.argv[2] ||
  String(process.env.WHATSAPP_VER || "").trim().replace(/\D/g, "");

const trunc = (s, n = 400) => {
  const t = String(s || "");
  if (t.length <= n) return t;
  return `${t.slice(0, n)}… [+${t.length - n} chars]`;
};

const main = async () => {
  if (!waArg || waArg.length < 8) {
    console.error("Uso: node scripts/whatsapp/ver-estado-chat-whatsapp.js <solo_digitos>");
    process.exit(1);
  }
  const wa = waArg.replace(/\D/g, "");
  console.log(`=== Estado chat / consultas para whatsapp ${wa} ===\n`);

  const u = await query(
    `
    SELECT id, nombre, whatsapp, whatsapp_real, whatsapp_jid, provincia, partido, plan, activo, creado_en
    FROM usuarios
    WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
       OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
    ORDER BY id DESC
    LIMIT 3
    `,
    [wa]
  );
  console.log("--- Usuario(s) ---");
  console.log(u.rows.length ? JSON.stringify(u.rows, null, 2) : "(ningún usuario con ese número)");

  const ob = await query(
    `SELECT * FROM onboarding_estado WHERE whatsapp = $1`,
    [wa]
  );
  console.log("\n--- onboarding_estado ---");
  console.log(ob.rows.length ? JSON.stringify(ob.rows, null, 2) : "(sin fila)");

  const bc = await query(
    `SELECT * FROM whatsapp_bot_control WHERE regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') = $1`,
    [wa]
  );
  console.log("\n--- whatsapp_bot_control ---");
  console.log(bc.rows.length ? JSON.stringify(bc.rows, null, 2) : "(sin fila = default activo si no tocó PAUSAR)");

  const uid = u.rows[0]?.id;
  const histSql = uid
    ? `
    SELECT id, usuario_id, whatsapp,
      LEFT(pregunta, 200) AS pregunta_ini,
      LEFT(respuesta, 200) AS respuesta_ini,
      ia_provider,
      creado_en
    FROM historial_consultas
    WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
       OR usuario_id = $2
    ORDER BY creado_en DESC
    LIMIT 15
  `
    : `
    SELECT id, usuario_id, whatsapp,
      LEFT(pregunta, 200) AS pregunta_ini,
      LEFT(respuesta, 200) AS respuesta_ini,
      ia_provider,
      creado_en
    FROM historial_consultas
    WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
    ORDER BY creado_en DESC
    LIMIT 15
  `;
  const hist = await query(histSql, uid ? [wa, uid] : [wa]);
  console.log("\n--- Últimas entradas historial_consultas (15) ---");
  if (!hist.rows.length) {
    console.log("(vacío)");
  } else {
    for (const r of hist.rows) {
      console.log(
        `\n#${r.id} ${r.creado_en} | usuario_id=${r.usuario_id} | ${r.ia_provider || "-"}`
      );
      console.log("  Q:", trunc(r.pregunta_ini, 300));
      console.log("  A:", trunc(r.respuesta_ini, 300));
    }
  }

  const cap = await query(
    `
    SELECT id, direccion, ruta, LEFT(cuerpo, 300) AS cuerpo_ini, creado_en
    FROM whatsapp_interaccion_log
    WHERE whatsapp_norm = $1
    ORDER BY creado_en DESC
    LIMIT 20
    `,
    [wa]
  );
  console.log("\n--- whatsapp_interaccion_log (20, solo si el número está en CAPTURA_HILO_WHATSAPP) ---");
  console.log(
    cap.rows.length
      ? cap.rows.map((r) => `${r.creado_en} [${r.direccion}] ${r.ruta || ""}\n  ${trunc(r.cuerpo_ini, 280)}`).join("\n\n")
      : "(sin filas: no hubo captura o el número no está en CAPTURA_HILO_WHATSAPP)"
  );
};

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => pool.end());
