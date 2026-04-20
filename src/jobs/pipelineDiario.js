const { sincronizarPreciosBoletinBcr } = require("./syncBcrBoletin");
const { armarTextoContexto } = require("../utils/boletinContexto");
const { generarResumenMercado } = require("../services/gemini");
const {
  enviarResumenYRegistrar,
  enviarResumenYRegistrarError,
} = require("../services/enviosWhatsapp");
const {
  WHATSAPP_SISTEMA,
  obtenerUsuarioSistemaId,
  upsertResumenPorFechaMercado,
} = require("../services/resumenes");

const ejecutarPipelineDiario = async ({
  persistirResumen = false,
  incluirDetalle = false,
  enviarWhatsapp,
} = {}) => {
  const sync = await sincronizarPreciosBoletinBcr();

  if (!persistirResumen) {
    return { sync, resumen: null, whatsapp: null };
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return {
      sync,
      resumen: { omitido: true, motivo: "GEMINI_API_KEY no configurada" },
      whatsapp: { omitido: true, motivo: "Sin resumen persistido (sin Gemini)" },
    };
  }

  const usuarioId = await obtenerUsuarioSistemaId();
  if (!usuarioId) {
    return {
      sync,
      resumen: {
        omitido: true,
        motivo: `No existe usuario sistema (whatsapp ${WHATSAPP_SISTEMA}). Ejecutar setup-db.`,
      },
      whatsapp: { omitido: true, motivo: "Sin usuario sistema para vincular envios" },
    };
  }

  const contexto = armarTextoContexto(sync.datos, incluirDetalle);
  const generado = await generarResumenMercado(contexto);
  const guardado = await upsertResumenPorFechaMercado({
    usuarioId,
    fechaMercadoTexto: sync.datos.fechaMercadoTexto,
    contenido: generado.texto,
    tokensUsados: generado.tokensUsados,
  });

  const resumenOut = {
    id: guardado.id,
    usuarioId: guardado.usuario_id,
    fecha: guardado.fecha,
    tokensUsados: guardado.tokens_usados,
    model: generado.model,
  };

  let whatsapp = null;
  const puedeIntentarWp = enviarWhatsapp !== false;

  if (!puedeIntentarWp) {
    whatsapp = { omitido: true, motivo: "enviarWhatsapp=false" };
  } else {
    const titulo = `*AgroHabilis* — Boletín #${sync.datos.boletinNumero} (${sync.datos.fechaMercadoTexto})\n\n`;
    const texto = `${titulo}${generado.texto}`;
    try {
      const envio = await enviarResumenYRegistrar({
        usuarioId,
        resumenId: guardado.id,
        texto,
      });
      whatsapp = { ok: true, messageId: envio.messageId };
    } catch (error) {
      await enviarResumenYRegistrarError({
        usuarioId,
        resumenId: guardado.id,
        error,
      });
      whatsapp = { ok: false, error: error.message };
    }
  }

  return {
    sync,
    resumen: resumenOut,
    whatsapp,
  };
};

module.exports = { ejecutarPipelineDiario };
