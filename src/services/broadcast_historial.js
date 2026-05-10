"use strict";

const { guardarConsulta } = require("../models/consulta");
const { normalizarWhatsapp } = require("../models/usuario");

/** Texto en `pregunta` para que el hilo de IA reconozca envíos proactivos del equipo. */
const PREGUNTA_MARCADOR_BROADCAST =
  "[AgroHabilis — mensaje del equipo por WhatsApp; no ingresó una consulta del productor. Las respuestas siguientes suelen ser feedback a esta campaña (aunque antes haya ido un recordatorio corto, p. ej. solo un saludo con el nombre).]";

/**
 * Registra en historial_consultas el texto realmente enviado en un masivo admin,
 * para que `obtenerUltimasInteracciones` / plantillas vean el contexto.
 */
const registrarEnvioMasivoEnHistorial = async ({
  usuarioId = null,
  whatsappRaw = "",
  textoFinal = "",
}) => {
  const wa = normalizarWhatsapp(whatsappRaw);
  const texto = String(textoFinal || "").trim();
  if (!texto || !usuarioId) return;
  if (!wa) return;
  await guardarConsulta({
    usuarioId,
    whatsapp: wa,
    pregunta: PREGUNTA_MARCADOR_BROADCAST,
    respuesta: texto,
    tokensUsados: null,
    iaSinContexto: null,
    iaProvider: "broadcast_admin",
    iaProviderTrace: { origen: "broadcast_admin", canal: "envio_masivo_admin" },
  });
};

module.exports = {
  PREGUNTA_MARCADOR_BROADCAST,
  registrarEnvioMasivoEnHistorial,
};
