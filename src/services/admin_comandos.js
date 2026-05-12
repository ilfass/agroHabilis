"use strict";

/**
 * Comandos solo para administradores del bot.
 *
 * Originalmente vivían como funciones LOCALES dentro de
 * `src/config/whatsapp.js` (historial git, ~líneas 431-627). Se
 * extrajeron al preparar el paso I del TurnController (P2#10).
 *
 * Comandos cubiertos:
 * - `ESTADO`, `ESTADO SISTEMA` → estado consolidado del bot (DB, IA, WA).
 * - `ESTADO IA` → orden de fallback de proveedores.
 * - `ESTADO DB` → conexión + última recolección de precios.
 * - `USUARIOS` → conteo + últimos 5.
 * - `FUENTES` → resumen del monitor de fuentes.
 * - `RESET ONBOARDING <numero>` → limpia onboarding+bot_control+
 *   historial vacío + soft-delete de usuarios coincidentes.
 *
 * Inyección de dependencia: `obtenerEstadoSistemaTexto` necesita saber
 * el estado runtime de WhatsApp (flags `ready`, `waState`, etc.) que
 * viven dentro de whatsapp.js. Para no acoplar, este módulo recibe un
 * `getEstadoWhatsapp` por opciones y, si no está, usa `"desconocido"`.
 */

const { query } = require("../config/database");
const { eliminarUsuarioSoft } = require("../models/usuario");
const { resumenFuentesWhatsapp } = require("./fuentes_monitor");

const COMANDOS_ADMIN_VALIDOS = new Set([
  "ESTADO",
  "ESTADO SISTEMA",
  "ESTADO IA",
  "ESTADO DB",
  "USUARIOS",
  "FUENTES",
]);

const normalizarComandoAdmin = (comando) =>
  String(comando || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

const normalizarNumeroAdmin = (valor = "") => String(valor).replace(/\D/g, "");

const formatearFecha = (valor) => {
  if (!valor) return "s/d";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
};

const estadoProveedorIA = () => {
  const disponibles = [];
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    disponibles.push(`OpenRouter(${process.env.OPENROUTER_MODEL || "openrouter/free"})`);
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    disponibles.push(`Groq(${process.env.GROQ_MODEL || "llama-3.1-8b-instant"})`);
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    disponibles.push(`Gemini(${process.env.GEMINI_MODEL || "gemini-flash-latest"})`);
  }
  if (!disponibles.length) return "sin proveedores configurados";
  return disponibles.join(" -> ");
};

/**
 * Estado consolidado del bot (DB + IA + WhatsApp + usuarios + planes).
 *
 * @param {{ getEstadoWhatsapp?: () => string }} [opts]
 */
const obtenerEstadoSistemaTexto = async ({ getEstadoWhatsapp } = {}) => {
  const [ultimaRecoleccion, ultimaCotizacion, ultimaConsulta, dbNow, usuarios, planes] =
    await Promise.all([
      query("SELECT MAX(creado_en) AS ts FROM precios"),
      query("SELECT MAX(fecha) AS fecha FROM tipo_cambio"),
      query("SELECT MAX(creado_en) AS ts FROM historial_consultas"),
      query("SELECT NOW() AS now"),
      query(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE activo = true)::int AS activos
          FROM usuarios
        `
      ),
      query(
        `
          SELECT plan, COUNT(*)::int AS total
          FROM usuarios
          GROUP BY plan
          ORDER BY total DESC
        `
      ),
    ]);

  const dbOk = Boolean(dbNow.rows[0]?.now);
  const resumenPlanes = planes.rows.length
    ? planes.rows.map((p) => `${p.plan || "sin_plan"}:${p.total}`).join(", ")
    : "sin usuarios";

  const estadoWA =
    typeof getEstadoWhatsapp === "function" ? getEstadoWhatsapp() : "desconocido";

  return [
    "📊 *Estado AgroHabilis*",
    `- WhatsApp: ${estadoWA}`,
    `- IA (orden): ${estadoProveedorIA()}`,
    `- Base de datos: ${dbOk ? "OK" : "ERROR"}`,
    `- DB time: ${formatearFecha(dbNow.rows[0]?.now)}`,
    `- Última recolección precios: ${formatearFecha(ultimaRecoleccion.rows[0]?.ts)}`,
    `- Último tipo de cambio: ${formatearFecha(ultimaCotizacion.rows[0]?.fecha)}`,
    `- Última consulta recibida: ${formatearFecha(ultimaConsulta.rows[0]?.ts)}`,
    `- Usuarios registrados: ${usuarios.rows[0]?.total || 0}`,
    `- Usuarios activos: ${usuarios.rows[0]?.activos || 0}`,
    `- Planes: ${resumenPlanes}`,
  ].join("\n");
};

/**
 * Despacha un comando admin si corresponde. Devuelve `null` si el
 * comando no matchea, "denegado" si quien lo manda no es admin, o el
 * texto de respuesta en otro caso.
 *
 * @param {string|null} _from JID del remitente. Solo para semántica (la
 *        decisión de admin se delega al caller vía `esAdmin`).
 * @param {string} comando
 * @param {{ esAdmin: boolean, getEstadoWhatsapp?: () => string }} opts
 */
const responderComandoAdmin = async (_from, comando, opts = {}) => {
  const cmd = normalizarComandoAdmin(comando);
  if (!COMANDOS_ADMIN_VALIDOS.has(cmd)) return null;
  if (!opts.esAdmin) {
    return "Este comando es solo para administradores.";
  }

  if (cmd === "ESTADO IA") {
    return `🧠 IA (orden de fallback): ${estadoProveedorIA()}`;
  }

  if (cmd === "ESTADO DB") {
    const db = await query("SELECT NOW() AS now");
    const ultimaRecoleccion = await query("SELECT MAX(creado_en) AS ts FROM precios");
    return [
      "🗄️ Estado DB",
      `- Conexión: ${db.rows[0]?.now ? "OK" : "ERROR"}`,
      `- Hora DB: ${formatearFecha(db.rows[0]?.now)}`,
      `- Última actualización precios: ${formatearFecha(ultimaRecoleccion.rows[0]?.ts)}`,
    ].join("\n");
  }

  if (cmd === "USUARIOS") {
    const usuarios = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE activo = true)::int AS activos
        FROM usuarios
      `
    );
    const ultimos = await query(
      `
        SELECT nombre, whatsapp, activo, creado_en
        FROM usuarios
        ORDER BY creado_en DESC
        LIMIT 5
      `
    );
    const lista =
      ultimos.rows
        .map(
          (u) =>
            `- ${u.nombre || "sin_nombre"} (${u.whatsapp}) ${u.activo ? "activo" : "inactivo"}`
        )
        .join("\n") || "- Sin registros";
    return [
      "👥 Usuarios",
      `- Registrados: ${usuarios.rows[0]?.total || 0}`,
      `- Activos: ${usuarios.rows[0]?.activos || 0}`,
      "- Últimos 5:",
      lista,
    ].join("\n");
  }

  if (cmd === "FUENTES") {
    return resumenFuentesWhatsapp();
  }

  return obtenerEstadoSistemaTexto({ getEstadoWhatsapp: opts.getEstadoWhatsapp });
};

/**
 * Resetea el onboarding y datos vinculados a un número (acción
 * destructiva — soft-delete de usuarios coincidentes).
 *
 * @param {string} numeroInput
 */
const resetOnboardingNumero = async (numeroInput = "") => {
  const numero = normalizarNumeroAdmin(numeroInput);
  if (!numero) {
    return { ok: false, error: "Número inválido. Usá: RESET ONBOARDING 549XXXXXXXXXX" };
  }

  const borradoOnboarding = await query(
    `
      DELETE FROM onboarding_estado
      WHERE
        regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
        OR whatsapp = ($1 || '@lid')
        OR whatsapp = ($1 || '@c.us')
    `,
    [numero]
  );

  const borradoBotControl = await query(
    `
      DELETE FROM whatsapp_bot_control
      WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
    `,
    [numero]
  );

  const limpiadoConsultasNull = await query(
    `
      DELETE FROM historial_consultas
      WHERE usuario_id IS NULL
        AND regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
    `,
    [numero]
  );

  const usuariosCoincidentes = await query(
    `
      SELECT id
      FROM usuarios
      WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(whatsapp_jid, ''), '\\D', '', 'g') = $1
    `,
    [numero]
  );
  let usuariosEliminados = 0;
  for (const row of usuariosCoincidentes.rows || []) {
    const eliminado = await eliminarUsuarioSoft(row.id);
    if (eliminado) usuariosEliminados += 1;
  }

  return {
    ok: true,
    numero,
    onboarding: borradoOnboarding.rowCount || 0,
    botControl: borradoBotControl.rowCount || 0,
    consultasNull: limpiadoConsultasNull.rowCount || 0,
    usuariosEliminados,
  };
};

module.exports = {
  COMANDOS_ADMIN_VALIDOS,
  formatearFecha,
  estadoProveedorIA,
  obtenerEstadoSistemaTexto,
  responderComandoAdmin,
  resetOnboardingNumero,
};
