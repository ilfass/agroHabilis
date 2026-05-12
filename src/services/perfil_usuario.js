"use strict";

/**
 * Helpers de perfil productivo del usuario, con DB.
 *
 * Originalmente eran funciones LOCALES dentro de `src/config/whatsapp.js`
 * (historial git, ~líneas 383-484). Se extrajeron al preparar el paso F
 * del TurnController (P2#10), para que el handler `cmd_perfil_directo`
 * pueda usarlas sin acoplarse a un símbolo interno de `whatsapp.js`.
 *
 * Tres responsabilidades:
 * - `guardarPerfilGanaderoUsuario`: upsert en `usuario_ganaderia_perfil`.
 * - `upsertPerfilProductivo`: marca el perfil productivo (`agricultura`,
 *   `ganaderia` o `mixto`).
 * - `obtenerTextoPerfilUsuario`: arma el bloque "Tu perfil actual"
 *   para mostrar al usuario.
 */

const { query } = require("../config/database");

/**
 * Reemplaza el perfil ganadero del usuario por la lista nueva.
 * Upsert por (`usuario_id`, `especie`, `categoria`).
 */
const guardarPerfilGanaderoUsuario = async ({ usuarioId, perfiles = [] }) => {
  await query("DELETE FROM usuario_ganaderia_perfil WHERE usuario_id = $1", [usuarioId]);
  for (const p of perfiles) {
    await query(
      `
        INSERT INTO usuario_ganaderia_perfil (usuario_id, especie, categoria, cantidad_estimada, activo)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (usuario_id, especie, categoria)
        DO UPDATE SET cantidad_estimada = EXCLUDED.cantidad_estimada, activo = true
      `,
      [usuarioId, p.especie, p.categoria, 1]
    );
  }
};

/**
 * Marca `perfil_productivo.tipo` del usuario. Si no existe fila previa,
 * inserta; si existe, actualiza la más reciente.
 *
 * @param {number} usuarioId
 * @param {"agricultura"|"ganaderia"|"mixto"} tipo
 */
const upsertPerfilProductivo = async (usuarioId, tipo) => {
  const current = await query(
    `
      SELECT id
      FROM perfil_productivo
      WHERE usuario_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  if (current.rows[0]) {
    await query(
      `
        UPDATE perfil_productivo
        SET tipo = $2, activo = true
        WHERE id = $1
      `,
      [current.rows[0].id, tipo]
    );
    return;
  }
  await query(
    `
      INSERT INTO perfil_productivo (usuario_id, tipo, activo)
      VALUES ($1, $2, true)
    `,
    [usuarioId, tipo]
  );
};

/**
 * Devuelve el texto multilinea que se muestra al usuario cuando pide
 * VER MI PERFIL.
 */
const obtenerTextoPerfilUsuario = async (usuarioId) => {
  const usuarioResult = await query(
    `
      SELECT nombre, provincia, partido, plan, tipo_comercializacion
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const usuario = usuarioResult.rows[0];
  if (!usuario) return "No encontré tu perfil.";
  const cultivosResult = await query(
    `
      SELECT cultivo
      FROM usuario_cultivos
      WHERE usuario_id = $1 AND activo = true
      ORDER BY cultivo
    `,
    [usuarioId]
  );
  const perfilResult = await query(
    `
      SELECT tipo
      FROM perfil_productivo
      WHERE usuario_id = $1 AND activo = true
      ORDER BY id DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  const stock = await query(
    `
      SELECT categoria, cantidad
      FROM stock_ganadero
      WHERE usuario_id = $1
        AND fecha = (SELECT MAX(fecha) FROM stock_ganadero WHERE usuario_id = $1)
      ORDER BY categoria
    `,
    [usuarioId]
  );
  const cultivos = cultivosResult.rows.map((r) => r.cultivo);
  const stockTxt = stock.rows.length
    ? stock.rows.map((s) => `${s.categoria}:${s.cantidad}`).join(", ")
    : "sin datos";
  return [
    "👤 *Tu perfil actual*",
    `Nombre: ${usuario.nombre || "-"}`,
    `Zona: ${usuario.provincia || "-"}, ${usuario.partido || "-"}`,
    `Plan: ${String(usuario.plan || "gratis").toUpperCase()}`,
    `Comercialización: ${usuario.tipo_comercializacion || "disponible"}`,
    `Perfil productivo: ${perfilResult.rows[0]?.tipo || "agricultura"}`,
    `Cultivos: ${cultivos.length ? cultivos.join(", ") : "sin cultivos"}`,
    `Ganado (último stock): ${stockTxt}`,
  ].join("\n");
};

module.exports = {
  guardarPerfilGanaderoUsuario,
  upsertPerfilProductivo,
  obtenerTextoPerfilUsuario,
};
