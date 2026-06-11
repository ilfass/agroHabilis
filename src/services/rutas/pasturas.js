"use strict";

const { query } = require("../../config/database");
const H = require("../consultas/legacy_helpers");
const { hayProveedorIa, ejecutarJsonConCadenaIA } = require("../agent/ia/json_chain");

const norm = (s = "") =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// ─── Extracción con IA ──────────────────────────────────────────────────────

const SYSTEM_EXTRACTOR = [
  "Sos un extractor de datos de pasturas para un sistema agropecuario argentino.",
  "Del mensaje recibido extraé un JSON con exactamente estos campos:",
  '{"tipo":"string","lote_nombre":"string|null","cabezas":number|null,"dias_descanso":number|null,"observacion":"string|null"}',
  "",
  "Valores permitidos para 'tipo':",
  "  'rebrote'         — el lote/potrero tiene rebrote disponible o está listo para pastoreo",
  "  'ingreso_animales' — entraron/ingresaron animales al lote",
  "  'retiro_animales'  — salieron/retiraron animales del lote",
  "  'inicio_descanso'  — el lote empezó período de descanso / clausura",
  "  'pesaje_pasto'     — se pesó o estimó disponibilidad de forraje",
  "  'nota'             — observación general sin categoría clara",
  "",
  "Reglas:",
  "- 'lote_nombre': nombre o número del potrero/lote mencionado. null si no se menciona.",
  "- 'dias_descanso': número entero de días si se menciona, null si no.",
  "- 'cabezas': cantidad de animales mencionada, null si no.",
  "- 'observacion': resto de info relevante en texto libre, null si nada.",
  "- Respondé SOLO el JSON, sin explicación.",
].join("\n");

async function extraerDatosPastura(mensaje) {
  if (!hayProveedorIa()) {
    // Fallback heurístico básico cuando no hay IA
    return extraerHeuristico(mensaje);
  }

  try {
    const res = await ejecutarJsonConCadenaIA({
      system: SYSTEM_EXTRACTOR,
      user: `Mensaje: ${String(mensaje || "").trim()}`,
      maxTokens: 200,
      contextLabel: "IA.pasturas_extractor",
    });
    if (res?.parsed && typeof res.parsed === "object") {
      return sanitizarExtraccion(res.parsed);
    }
  } catch (_e) {
    // fall through to heuristic
  }
  return extraerHeuristico(mensaje);
}

function sanitizarExtraccion(raw) {
  const TIPOS_VALIDOS = [
    "rebrote",
    "ingreso_animales",
    "retiro_animales",
    "inicio_descanso",
    "pesaje_pasto",
    "nota",
  ];
  const tipo = TIPOS_VALIDOS.includes(String(raw?.tipo || ""))
    ? raw.tipo
    : "nota";
  return {
    tipo,
    lote_nombre: raw?.lote_nombre ? String(raw.lote_nombre).trim() : null,
    cabezas: Number.isFinite(Number(raw?.cabezas)) && Number(raw.cabezas) > 0
      ? Math.round(Number(raw.cabezas))
      : null,
    dias_descanso:
      Number.isFinite(Number(raw?.dias_descanso)) && Number(raw.dias_descanso) >= 0
        ? Math.round(Number(raw.dias_descanso))
        : null,
    observacion: raw?.observacion ? String(raw.observacion).trim() : null,
  };
}

function extraerHeuristico(mensaje) {
  const t = norm(mensaje);

  let tipo = "nota";
  if (/\b(rebrote|listo\s+para\s+pastoreo|disponible\s+para\s+pastoreo)\b/.test(t))
    tipo = "rebrote";
  else if (/\b(ingres[aó]|entraron|metieron|empez[oó]\s+el\s+pastoreo)\b/.test(t))
    tipo = "ingreso_animales";
  else if (/\b(retir[oó]|salieron|sac[oó]|quitaron|empez[oó]\s+el\s+descanso|clausur)\b/.test(t))
    tipo = "retiro_animales";
  else if (/\b(inicio\s+descanso|empieza\s+el\s+descanso|clausur|en\s+descanso)\b/.test(t))
    tipo = "inicio_descanso";
  else if (/\b(pesaje\s+pasto|kg\s+de\s+pasto|ms\/ha|materia\s+seca)\b/.test(t))
    tipo = "pesaje_pasto";

  const loteMatch = mensaje.match(
    /(?:lote|potrero|parcela|campo|verdeo|pastura)\s+([A-Za-z0-9\u00C0-\u024F\s#\-]+?)(?:\s|,|$|\.)/i
  );
  const lote_nombre = loteMatch ? loteMatch[1].trim() : null;

  const diasMatch = mensaje.match(/(\d+)\s*(?:días?|dias?)\s*(?:de\s+)?descanso/i) ||
    mensaje.match(/(\d+)\s*semanas?\s*(?:de\s+)?descanso/i);
  let dias_descanso = null;
  if (diasMatch) {
    const n = Number(diasMatch[1]);
    dias_descanso = /semana/i.test(diasMatch[0]) ? n * 7 : n;
  }

  const cabezasMatch = mensaje.match(/(\d+)\s*(?:novillos?|vacas?|terner[oa]s?|animales?|cabezas?)/i);
  const cabezas = cabezasMatch ? Number(cabezasMatch[1]) : null;

  return { tipo, lote_nombre, cabezas, dias_descanso, observacion: null };
}

// ─── Resolución de lote ─────────────────────────────────────────────────────

async function resolverLote(usuarioId, nombreTextual) {
  if (!nombreTextual) return { ubicacion_id: null, lote_nombre: null };

  // Buscar por coincidencia exacta primero, luego parcial (ILIKE)
  const exacto = await query(
    `SELECT id, nombre FROM ubicaciones
     WHERE usuario_id = $1 AND LOWER(nombre) = LOWER($2)
     LIMIT 1`,
    [usuarioId, nombreTextual]
  );
  if (exacto.rows.length) {
    return { ubicacion_id: exacto.rows[0].id, lote_nombre: exacto.rows[0].nombre };
  }

  const parcial = await query(
    `SELECT id, nombre FROM ubicaciones
     WHERE usuario_id = $1
       AND (LOWER(nombre) LIKE '%' || LOWER($2) || '%'
         OR LOWER($2) LIKE '%' || LOWER(nombre) || '%')
     ORDER BY LENGTH(nombre) ASC
     LIMIT 1`,
    [usuarioId, nombreTextual]
  );
  if (parcial.rows.length) {
    return { ubicacion_id: parcial.rows[0].id, lote_nombre: parcial.rows[0].nombre };
  }

  // No encontrado → guardar nombre textual sin FK
  return { ubicacion_id: null, lote_nombre: nombreTextual };
}

// ─── Inserción ──────────────────────────────────────────────────────────────

async function insertarEventoPastura({
  usuarioId,
  ubicacion_id,
  lote_nombre,
  tipo,
  cabezas,
  dias_descanso,
  observacion,
}) {
  const res = await query(
    `INSERT INTO eventos_pastura
       (usuario_id, ubicacion_id, lote_nombre, tipo, cabezas, dias_descanso, observacion, fecha_evento)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE)
     RETURNING id, fecha_evento`,
    [usuarioId, ubicacion_id || null, lote_nombre || null, tipo, cabezas || null, dias_descanso || null, observacion || null]
  );
  return res.rows[0];
}

// ─── Texto de confirmación ──────────────────────────────────────────────────

const EMOJI_TIPO = {
  rebrote: "🌿",
  ingreso_animales: "🐄",
  retiro_animales: "🔄",
  inicio_descanso: "💤",
  pesaje_pasto: "⚖️",
  nota: "📝",
};

const LABEL_TIPO = {
  rebrote: "Rebrote / Listo para pastoreo",
  ingreso_animales: "Ingreso de animales",
  retiro_animales: "Retiro de animales",
  inicio_descanso: "Inicio de descanso",
  pesaje_pasto: "Pesaje de pasto",
  nota: "Observación",
};

function construirConfirmacion({ tipo, lote_nombre, cabezas, dias_descanso, observacion, fechaEvento }) {
  const emoji = EMOJI_TIPO[tipo] || "📝";
  const label = LABEL_TIPO[tipo] || tipo;
  const loteStr = lote_nombre ? ` — *${lote_nombre}*` : "";
  const fecha = fechaEvento
    ? ` (${new Date(fechaEvento).toLocaleDateString("es-AR")})`
    : "";

  const lineas = [
    `${emoji} *Evento de pastura registrado*${loteStr}${fecha}`,
    `Tipo: ${label}`,
  ];
  if (cabezas) lineas.push(`Animales: ${cabezas} cabezas`);
  if (dias_descanso != null) lineas.push(`Días de descanso: ${dias_descanso}`);
  if (observacion) lineas.push(`Nota: ${observacion}`);

  if (!lote_nombre) {
    lineas.push(`\n_No encontré el lote en tus registros. El evento quedó guardado sin lote asociado._`);
  }

  return lineas.join("\n");
}

// ─── Ruta principal ─────────────────────────────────────────────────────────

const rutaPasturas = async ({ mensaje, usuario }) => {
  if (!usuario?.id) {
    return "Para registrar datos de pasturas necesito tu perfil. Mandame un hola y te guío.";
  }

  const datos = await extraerDatosPastura(mensaje);

  if (!datos.tipo || datos.tipo === "nota" && !datos.lote_nombre && !datos.observacion) {
    return (
      "No pude interpretar el evento de pastura. " +
      "Probá con algo como: _«el potrero 4 ya tiene rebrote, 21 días de descanso»_ " +
      "o _«ingresaron 80 novillos al lote Norte»_."
    );
  }

  const { ubicacion_id, lote_nombre } = await resolverLote(usuario.id, datos.lote_nombre);

  const fila = await insertarEventoPastura({
    usuarioId: usuario.id,
    ubicacion_id,
    lote_nombre,
    tipo: datos.tipo,
    cabezas: datos.cabezas,
    dias_descanso: datos.dias_descanso,
    observacion: datos.observacion,
  });

  return construirConfirmacion({
    tipo: datos.tipo,
    lote_nombre: lote_nombre || datos.lote_nombre,
    cabezas: datos.cabezas,
    dias_descanso: datos.dias_descanso,
    observacion: datos.observacion,
    fechaEvento: fila?.fecha_evento,
  });
};

// ─── Utilidades para otros módulos ──────────────────────────────────────────

/**
 * Devuelve el último evento de pastura de cada lote para el usuario.
 * Usado por consulta_registros para mostrar el estado real del semáforo.
 */
async function obtenerUltimosEventosPastura(usuarioId) {
  const res = await query(
    `SELECT DISTINCT ON (COALESCE(ubicacion_id::text, lote_nombre))
       ubicacion_id, lote_nombre, tipo, cabezas, dias_descanso, fecha_evento, observacion
     FROM eventos_pastura
     WHERE usuario_id = $1
     ORDER BY COALESCE(ubicacion_id::text, lote_nombre), fecha_evento DESC, id DESC`,
    [usuarioId]
  );
  return res.rows;
}

/**
 * Devuelve el semáforo de pastura basado en el último evento real.
 */
function calcularSemaforoPastura({ tipo, dias_descanso, fecha_evento }) {
  if (!tipo) return { emoji: "⚪", label: "Sin datos" };

  switch (tipo) {
    case "ingreso_animales":
      return { emoji: "🔴", label: "Ocupado / En pastoreo" };
    case "retiro_animales":
    case "inicio_descanso": {
      if (!fecha_evento) return { emoji: "🟡", label: "En descanso" };
      const diasTranscurridos = Math.floor(
        (Date.now() - new Date(fecha_evento).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diasTranscurridos < 20) return { emoji: "🔴", label: `Descanso (${diasTranscurridos} días)` };
      if (diasTranscurridos < 35) return { emoji: "🟡", label: `Rebrote (${diasTranscurridos} días)` };
      return { emoji: "🟢", label: `Listo (${diasTranscurridos} días)` };
    }
    case "rebrote":
      if (dias_descanso != null) {
        if (dias_descanso >= 35) return { emoji: "🟢", label: `Listo (${dias_descanso} días descanso)` };
        return { emoji: "🟡", label: `Rebrote (${dias_descanso} días)` };
      }
      return { emoji: "🟢", label: "Rebrote disponible" };
    case "pesaje_pasto":
      return { emoji: "🟡", label: "Pesaje registrado" };
    default:
      return { emoji: "⚪", label: "Sin estado definido" };
  }
}

module.exports = {
  rutaPasturas,
  obtenerUltimosEventosPastura,
  calcularSemaforoPastura,
};
