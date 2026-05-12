"use strict";

/**
 * Handler: `resumen_interactivo` — turnos dentro del resumen interactivo.
 *
 * Origen: `src/config/whatsapp.js` líneas 743-781.
 *
 * Es **stateful**: hay una conversación abierta cuya marca está en
 * `conversacion_estado` con `flujo = "resumen_interactivo"`. El handler
 * captura los siguientes mensajes del usuario hasta que el resumen
 * termine.
 *
 * Excepciones (los comandos pasan al pipeline normal):
 * - Admins quedan exentos.
 * - Si la consulta parece un comando de alta prioridad (QUIERO PLAN,
 *   VER COMANDOS, MI PLAN, DETENER RESUMEN, BORRAR/ELIMINAR, MIS X,
 *   MI EMAIL, MI RESUMEN), no interrumpimos lo que el usuario quiso
 *   hacer.
 * - También si lo único que mandó es un email "a secas".
 *
 * Migrado en: P2#10 paso L.3.
 *
 * Resolución de la clave de estado:
 *  1) Primero intenta por número normalizado.
 *  2) Si no, busca por usuario_id (para casos donde el JID rotó entre
 *     `@lid` y `@c.us`).
 */

const conversacionEstadoService = require("../conversacion_estado");
const resumenInteractivo = require("../resumen_interactivo");
const { normalizarWhatsapp } = require("../../models/usuario");
const { formatearRespuestaAmigable } = require("../whatsapp_textos");

const REGEX_COMANDO_PRIORIDAD =
  /^(QUIERO\s+PLAN|VER\s+COMANDO|VER\s+COMANDOS|MI\s+PLAN\b|DETENER\s+RESUMEN|BORRAR|ELIMINAR|MIS\s+|MI\s+EMAIL\b|MI\s+RESUMEN\b)/i;
const REGEX_EMAIL_SOLO = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*$/i;

const pareceComandoPrioridadResumen = (consulta) => {
  const t = String(consulta || "").trim();
  return REGEX_COMANDO_PRIORIDAD.test(t) || REGEX_EMAIL_SOLO.test(t);
};

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerResumenInteractivo(ctx) {
  if (ctx?.esAdmin) return { manejado: false };
  if (pareceComandoPrioridadResumen(ctx.consulta)) return { manejado: false };

  const waN =
    normalizarWhatsapp(ctx.numeroNormalizado || ctx.jid) ||
    normalizarWhatsapp(ctx.jid);
  let waClaveEstado = waN;
  let est = await conversacionEstadoService.obtenerEstado(waClaveEstado);

  if (est?.flujo !== "resumen_interactivo" && ctx?.planCtx?.usuario?.id) {
    const porUsuario =
      await conversacionEstadoService.obtenerEstadoResumenInteractivoPorUsuarioId(
        ctx.planCtx.usuario.id
      );
    if (porUsuario) {
      est = porUsuario;
      const k = String(porUsuario.whatsapp || "").replace(/\D/g, "");
      if (k) waClaveEstado = k;
    }
  }

  if (est?.flujo !== "resumen_interactivo") return { manejado: false };

  const enviarResumenI = async (texto) => {
    const out = formatearRespuestaAmigable(String(texto || ""));
    if (typeof ctx.send === "function") {
      await ctx.send(out);
    }
    if (typeof ctx.emitCaptura === "function") {
      try {
        ctx.emitCaptura(out, "resumen_interactivo");
      } catch (e) {
        console.warn("[resumen_interactivo] emitCaptura falló:", e?.message || e);
      }
    }
  };

  const manejado = await resumenInteractivo.procesarRespuestaResumen({
    whatsapp: waClaveEstado,
    mensaje: ctx.consulta || "",
    enviar: enviarResumenI,
  });
  if (!manejado) return { manejado: false };

  return {
    manejado: true,
    respuesta: null,
    route: "RESUMEN_INTERACTIVO",
  };
}

module.exports = { handlerResumenInteractivo };
