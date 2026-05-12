"use strict";

/**
 * Handler: `cmd_resumen` — comando `MI RESUMEN` (resumen agro interactivo).
 *
 * Origen: `src/config/whatsapp.js` líneas 1828-1862.
 * Match: `comandoAlias === "MI RESUMEN"` o `comandoNatural === "MI RESUMEN"`.
 *
 * Migrado en: P2#10 paso C.
 *
 * Particularidades:
 * - Dispara `resumenInteractivo.iniciarResumen`, que envía mensajes vía
 *   `ctx.send` (callback `enviar`).
 * - Cuando inicia el flujo correctamente, NO hay `respuesta` que devolver
 *   (el flujo ya envió la invitación). Devolvemos `{manejado:true,
 *   respuesta:null}` para que el caller no duplique.
 * - Hay dos cortocircuitos con respuesta inline: sin usuario, y `omitido`.
 */

const { buscarPorWhatsapp, normalizarWhatsapp } = require("../../models/usuario");
const { guardarConsulta } = require("../../models/consulta");
const resumenInteractivo = require("../resumen_interactivo");

/**
 * @param {import("../agent/turn_controller").TurnContext} ctx
 */
async function handlerCmdResumen(ctx) {
  const alias = String(ctx?.comandoAlias || "").toUpperCase();
  const natural = String(ctx?.comandoNatural || "").toUpperCase();
  if (alias !== "MI RESUMEN" && natural !== "MI RESUMEN") {
    return { manejado: false };
  }

  const usuario = await buscarPorWhatsapp(ctx.jid);
  if (!usuario) {
    return {
      manejado: true,
      respuesta:
        "Primero necesitamos completar tu perfil. Responde las preguntas de onboarding para habilitar tu resumen diario.",
      route: "CMD_MI_RESUMEN",
      extraLog: { sin_usuario: true },
    };
  }

  const outMi = await resumenInteractivo.iniciarResumen(usuario, {
    enviar: (texto) => ctx.send(texto),
  });
  if (outMi?.omitido) {
    return {
      manejado: true,
      respuesta:
        "Terminá primero lo que te preguntó el bot (registro o *COMPLETAR PERFIL*) y después escribí *MI RESUMEN*.",
      route: "CMD_MI_RESUMEN",
      extraLog: { omitido: true },
    };
  }

  try {
    await guardarConsulta({
      usuarioId: usuario.id,
      whatsapp: normalizarWhatsapp(ctx.jid),
      pregunta: String(ctx.consulta || "").trim() || "MI RESUMEN",
      respuesta: "[Resumen interactivo: invitación enviada]",
      tokensUsados: null,
      iaSinContexto: null,
      iaProvider: "resumen_interactivo",
      iaProviderTrace: [{ stage: "flujo", value: "invitacion" }],
    });
  } catch (e) {
    console.warn("[CMD_MI_RESUMEN] No se pudo guardar historial:", e?.message);
  }

  /**
   * `iniciarResumen` ya envió la invitación. No queremos un mensaje extra
   * del caller: respuesta = null indica "manejado pero ya respondí".
   */
  return {
    manejado: true,
    respuesta: null,
    route: "CMD_MI_RESUMEN",
    extraLog: { flujo: "invitacion_enviada" },
  };
}

module.exports = { handlerCmdResumen };
