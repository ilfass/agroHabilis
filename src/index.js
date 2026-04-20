require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const { testConnection } = require("./config/database");
const { sincronizarPreciosBoletinBcr } = require("./jobs/syncBcrBoletin");
const { ejecutarPipelineDiario } = require("./jobs/pipelineDiario");
const { obtenerDatosUltimoBoletin } = require("./scrapers/bcrBoletin");
const { generarResumenMercado } = require("./services/gemini");
const {
  initializeWhatsApp,
  sendMessage,
} = require("./config/whatsapp");
const {
  obtenerUsuarioSistemaId,
  upsertResumenPorFechaMercado,
} = require("./services/resumenes");
const { armarTextoContexto } = require("./utils/boletinContexto");
const {
  enviarResumenYRegistrar,
  enviarResumenYRegistrarError,
} = require("./services/enviosWhatsapp");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    status: "ok",
    app: "AgroHabilis",
    version: "1.0.0",
  });
});

app.post("/jobs/bcr-boletin", async (_req, res) => {
  try {
    const resultado = await sincronizarPreciosBoletinBcr();
    res.json(resultado);
  } catch (error) {
    console.error("Fallo job BCR boletin:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/jobs/pipeline-diario", async (req, res) => {
  try {
    const persistirResumen = req.body?.persistirResumen !== false;
    const incluirDetalle = Boolean(req.body?.incluirDetalle);
    const resultado = await ejecutarPipelineDiario({
      persistirResumen,
      incluirDetalle,
      enviarWhatsapp: req.body?.enviarWhatsapp,
    });
    res.json({ ok: true, ...resultado });
  } catch (error) {
    console.error("Fallo pipeline diario:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/debug/bcr-boletin", async (_req, res) => {
  try {
    const datos = await obtenerDatosUltimoBoletin();
    res.json({
      ok: true,
      boletinNumero: datos.boletinNumero,
      pdfUrl: datos.pdfUrl,
      fechaMercadoTexto: datos.fechaMercadoTexto,
      minimos: datos.minimos,
    });
  } catch (error) {
    console.error("Fallo debug BCR boletin:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/jobs/whatsapp-test", async (req, res) => {
  try {
    const numero = req.body?.numero || process.env.WHATSAPP_DESTINO;
    if (!numero) throw new Error("Falta numero en body.numero o WHATSAPP_DESTINO");
    const mensaje =
      req.body?.mensaje ||
      "Prueba AgroHabilis: whatsapp-web.js respondio OK.";
    const envio = await sendMessage(numero, mensaje);
    res.json({ ok: true, id: envio.id?._serialized || null });
  } catch (error) {
    console.error("Fallo test WhatsApp:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/ai/resumen-mercado", async (req, res) => {
  try {
    const datos = await obtenerDatosUltimoBoletin();
    const contexto = armarTextoContexto(datos, Boolean(req.body?.incluirDetalle));

    const resumen = await generarResumenMercado(contexto);

    let persistido = null;
    let whatsapp = null;
    if (req.body?.persistir) {
      const usuarioId = await obtenerUsuarioSistemaId();
      if (!usuarioId) {
        throw new Error(
          "No hay usuario sistema para guardar resumenes. Ejecuta: node scripts/setup-db.js"
        );
      }
      persistido = await upsertResumenPorFechaMercado({
        usuarioId,
        fechaMercadoTexto: datos.fechaMercadoTexto,
        contenido: resumen.texto,
        tokensUsados: resumen.tokensUsados,
      });

      const puedeWp = req.body?.enviarWhatsapp !== false;
      if (puedeWp) {
        const titulo = `*AgroHabilis* — Boletín #${datos.boletinNumero} (${datos.fechaMercadoTexto})\n\n`;
        const texto = `${titulo}${resumen.texto}`;
        try {
          const envio = await enviarResumenYRegistrar({
            usuarioId,
            resumenId: persistido.id,
            texto,
          });
          whatsapp = { ok: true, messageId: envio.messageId };
        } catch (error) {
          await enviarResumenYRegistrarError({
            usuarioId,
            resumenId: persistido.id,
            error,
          });
          whatsapp = { ok: false, error: error.message };
        }
      } else {
        whatsapp = { omitido: true, motivo: "enviarWhatsapp=false" };
      }
    }

    res.json({
      ok: true,
      model: resumen.model,
      tokensUsados: resumen.tokensUsados,
      resumen: resumen.texto,
      persistido,
      whatsapp,
    });
  } catch (error) {
    console.error("Fallo resumen Gemini:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

const programarJobs = () => {
  const tz = "America/Argentina/Buenos_Aires";
  cron.schedule(
    "0 9 * * *",
    async () => {
      try {
        const resultado = await ejecutarPipelineDiario({
          persistirResumen: true,
          incluirDetalle: false,
        });
        console.log("Pipeline diario OK:", resultado);
      } catch (error) {
        console.error("Pipeline diario ERROR:", error.message);
      }
    },
    { timezone: tz }
  );
  console.log(
    "Cron configurado: pipeline diario BCR + resumen + WhatsApp (09:00 AR; resumen si hay GEMINI; WhatsApp si hay credenciales Cloud)."
  );
};

const startServer = async () => {
  try {
    await testConnection();
    await initializeWhatsApp();
    programarJobs();
    app.listen(PORT, () => {
      console.log(`AgroHabilis escuchando en puerto ${PORT}`);
    });
  } catch (error) {
    console.error("No se pudo iniciar la aplicacion:", error.message);
    process.exit(1);
  }
};

startServer();
