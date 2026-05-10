#!/usr/bin/env node
/**
 * Lista usuarios y si quedan equivalentes a "fuera de onboarding" según la misma idea
 * que gestionarOnboarding (estado completado en BD o perfil mínimo operativo).
 *
 * Uso: node scripts/report-onboarding-usuarios.js
 *        DATABASE_URL=... node scripts/report-onboarding-usuarios.js   # otra BD
 */
require("dotenv").config();
const path = require("path");
const { query, pool } = require(path.join(__dirname, "..", "src", "config", "database"));

const soloDigitos = (t) => String(t || "").replace(/\D/g, "") || null;

const main = async () => {
  const { rows: usuarios } = await query(
    `SELECT id, nombre, whatsapp, whatsapp_real, provincia, partido, activo
     FROM usuarios
     ORDER BY id`
  );

  const lineas = [];
  let ok = 0;
  let pend = 0;

  for (const u of usuarios) {
    const claves = [...new Set([soloDigitos(u.whatsapp), soloDigitos(u.whatsapp_real)].filter(Boolean))];
    let ob = null;
    for (const k of claves) {
      const r = await query(
        `SELECT completado, paso_actual FROM onboarding_estado WHERE whatsapp = $1 LIMIT 1`,
        [k]
      );
      if (r.rows[0]) {
        ob = r.rows[0];
        break;
      }
    }

    const cult = await query(
      `SELECT COUNT(*)::int AS n FROM usuario_cultivos WHERE usuario_id = $1 AND activo = true`,
      [u.id]
    );
    const nCultivos = cult.rows[0]?.n ?? 0;

    const pr = await query(
      `SELECT tipo FROM perfil_productivo WHERE usuario_id = $1 AND activo = true ORDER BY id DESC LIMIT 1`,
      [u.id]
    );
    const tipoPerfil = pr.rows[0]?.tipo ?? null;

    const datosBasicos =
      String(u.nombre || "").trim().length >= 2 &&
      String(u.provincia || "").trim() &&
      String(u.partido || "").trim();

    const ganaderiaOk = tipoPerfil === "ganaderia" || tipoPerfil === "mixto";
    const perfilOperativo = datosBasicos && (nCultivos > 0 || ganaderiaOk);
    const onboardingBd = Boolean(ob?.completado);
    const fueraOnboarding = onboardingBd || perfilOperativo;

    if (fueraOnboarding) ok += 1;
    else pend += 1;

    const motivo = onboardingBd
      ? "onboarding_estado.completado"
      : perfilOperativo
        ? `perfil (${nCultivos > 0 ? `${nCultivos} cultivo(s)` : `sin cultivos; perfil ${tipoPerfil || "—"}`})`
        : !datosBasicos
          ? "faltan nombre(≥2) o provincia o partido"
          : "faltan cultivos activos y perfil ganadería/mixto";

    lineas.push({
      id: u.id,
      activo: u.activo,
      nombre: (u.nombre || "").slice(0, 40),
      wa: claves[0] || "—",
      ob_completo: ob?.completado ?? null,
      ob_paso: ob?.paso_actual ?? null,
      n_cultivos: nCultivos,
      perfil_tipo: tipoPerfil,
      estado: fueraOnboarding ? "OK" : "PENDIENTE",
      detalle: motivo,
    });
  }

  console.log("=== Onboarding / registro operativo por usuario ===\n");
  console.table(lineas);
  console.log(
    `\nResumen: ${usuarios.length} usuario(s) | OK (fuera de onboarding): ${ok} | Pendiente: ${pend}`
  );
  if (pend > 0) {
    console.log(
      "\nPENDIENTE = no marca completado en onboarding_estado y no cumple perfil mínimo (nombre+zona+cultivos o perfil ganadería/mixto)."
    );
  }
};

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(() => pool.end());
