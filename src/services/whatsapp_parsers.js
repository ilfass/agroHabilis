"use strict";

/**
 * Parsers puros para comandos directos de WhatsApp.
 *
 * Originalmente vivían como funciones LOCALES dentro de `src/config/whatsapp.js`
 * (ver historial git, ~líneas 101-160 y 358-381). Se extrajeron al
 * preparar el paso F del TurnController (P2#10), porque
 * `cmd_perfil_directo` los necesita y no estaban exportados.
 *
 * Reglas:
 * - Sin acceso a DB ni a IA: solo manipulación de strings.
 * - No tirar excepciones por inputs raros; devolver lista/objeto vacío
 *   o `null` y dejar que el handler decida el mensaje al usuario.
 * - No mutar argumentos.
 */

const { normalizarTexto } = require("./whatsapp_intents");

/** Catálogo cerrado de especies con keywords para inferencia. */
const ESPECIES_GANADERAS = [
  { especie: "vacuno", keys: ["vacuno", "bovino", "novillo", "ternero", "vaca", "vaquillona", "toro"] },
  { especie: "porcino", keys: ["porcino", "cerdo", "lechon", "lechón", "chancho"] },
  { especie: "ovino", keys: ["ovino", "oveja", "cordero", "carnero"] },
  { especie: "caprino", keys: ["caprino", "cabra", "chivo"] },
  { especie: "camelido", keys: ["llama", "alpaca", "guanaco", "vicuña", "vicuna", "camelido"] },
  { especie: "equino", keys: ["equino", "caballo", "yegua"] },
  { especie: "avicola", keys: ["avicola", "avícola", "pollo", "gallina", "ponedora"] },
];

/** `"Buenos Aires, Tandil"` → `{ provincia: "Buenos Aires", partido: "Tandil" }`. */
const parseProvinciaPartido = (texto = "") => {
  const parts = String(texto)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { provincia: parts[0], partido: parts.slice(1).join(", ") };
};

/**
 * `"Buenos Aires, Tandil - Córdoba, Río Cuarto"` → array de
 * `{provincia, partido}`. El separador entre zonas es ` - `.
 */
const parseZonas = (texto = "") =>
  String(texto)
    .split(/\s*-\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((bloque) => parseProvinciaPartido(bloque))
    .filter(Boolean);

/** `"soja, maiz, trigo"` → `["Soja","Maiz","Trigo"]` (capitalizado). */
const parseCultivos = (texto = "") =>
  String(texto)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());

/** Lista plana de categorías ganaderas en minúscula (sin inferencia). */
const parseCategoriasGanaderas = (texto = "") =>
  String(texto)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/** Extrae el primer email válido del texto o `null`. */
const parseEmail = (texto = "") => {
  const m = String(texto || "").trim().match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return m ? m[0].toLowerCase() : null;
};

/**
 * Si la línea es ÚNICAMENTE un correo (típico cuando el usuario contesta
 * solo con su email tras un pedido de "MI EMAIL"), lo devuelve;
 * si no, `null`. Una sola línea: si hay `\n`, no aplica.
 */
const esLineaSolamenteCorreo = (texto = "") => {
  const t = String(texto || "").trim();
  if (!t || /[\r\n]/.test(t)) return null;
  const email = parseEmail(t);
  if (!email) return null;
  return t.replace(/\s+/g, "").toLowerCase() === email ? email : null;
};

/** Heurística por palabras clave. Devuelve `"otra"` si no matchea ninguna. */
const inferirEspecieGanadera = (categoria = "") => {
  const t = normalizarTexto(categoria);
  const hit = ESPECIES_GANADERAS.find((e) => e.keys.some((k) => t.includes(normalizarTexto(k))));
  return hit?.especie || "otra";
};

/**
 * Convierte texto plano de ganadería en categorías + perfiles tipados.
 *
 * Ej:
 *   "vacuno novillos, vacuno terneros, porcino madres, llama" →
 *   {
 *     categorias: ["vacuno novillos","vacuno terneros","porcino madres","llama"],
 *     perfiles: [
 *       {especie:"vacuno", categoria:"vacuno novillos"},
 *       {especie:"vacuno", categoria:"vacuno terneros"},
 *       {especie:"porcino", categoria:"porcino madres"},
 *       {especie:"camelido", categoria:"llama"},
 *     ]
 *   }
 */
const parseGanaderiaEstructurada = (texto = "") => {
  const categorias = parseCategoriasGanaderas(texto);
  const perfiles = categorias.map((c) => ({
    especie: inferirEspecieGanadera(c),
    categoria: c.slice(0, 60),
  }));
  return { categorias, perfiles };
};

module.exports = {
  ESPECIES_GANADERAS,
  parseProvinciaPartido,
  parseZonas,
  parseCultivos,
  parseCategoriasGanaderas,
  parseEmail,
  esLineaSolamenteCorreo,
  inferirEspecieGanadera,
  parseGanaderiaEstructurada,
};
