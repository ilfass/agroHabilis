"use strict";

const { query } = require("../../config/database");

/**
 * Detecta si el mensaje actual de WhatsApp es una queja o reproche sobre la respuesta anterior.
 * Utiliza patrones conversacionales comunes en Argentina y español neutro.
 */
function detectarQuejaUsuario(mensaje = "") {
  const t = String(mensaje || "").trim().toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Quitar acentos

  if (!t) return false;

  // Expresiones de queja, reclamo o malentendido
  const patronesQueja = [
    /\bno\s+(me\s+)?(entend|respond|contest|capta)/,
    /\bentendiste\s+mal\b/,
    /\b(eso\s+)?no\s+es\s+(lo\s+)?que\s+te\s+(pregunt|ped|dij)/,
    /\bte\s+pregunt[eé]\s+otra\s+cosa\b/,
    /\bnada\s+que\s+ver\b/,
    /\b(es\s+)?cualquiera\b/,
    /\bno\s+tiene\s+nada\s+que\s+ver\b/,
    /\bte\s+estaba\s+(pregunt|ped|consult)/,
    /\bme\s+respondiste\s+cualquier\b/,
    /\bno\s+me\s+diste\s+bola\b/,
    /\bte\s+equivoc\w*\b/
  ];

  return patronesQueja.some((regex) => regex.test(t));
}

/**
 * Busca y recupera la última pregunta real del productor que el bot falló en responder.
 */
async function obtenerUltimaPreguntaFallida(whatsappNorm, usuarioId) {
  const params = [];
  let sql = `
    SELECT id, pregunta, respuesta 
    FROM historial_consultas 
  `;

  if (usuarioId) {
    sql += ` WHERE usuario_id = $1 OR whatsapp = $2 `;
    params.push(usuarioId, whatsappNorm);
  } else {
    sql += ` WHERE whatsapp = $1 `;
    params.push(whatsappNorm);
  }

  sql += ` ORDER BY id DESC LIMIT 1 `;

  const r = await query(sql, params);
  return r.rows[0] || null;
}

/**
 * Elimina el último registro conflictivo de historial_consultas para que no contamine 
 * el hilo que leerá el clasificador o el diálogo en este reintento.
 */
async function eliminarConsultaHistorial(id) {
  if (!id) return;
  await query(`DELETE FROM historial_consultas WHERE id = $1`, [id]);
}

module.exports = {
  detectarQuejaUsuario,
  obtenerUltimaPreguntaFallida,
  eliminarConsultaHistorial,
};
