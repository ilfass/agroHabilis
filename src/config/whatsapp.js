const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
} = require("../services/consultas");
const { gestionarOnboarding } = require("../services/onboarding");
const { generarResumen } = require("../services/resumen");
const { buscarPorWhatsapp } = require("../models/usuario");

const sessionPath = process.env.WHATSAPP_SESSION_PATH || "./.wwebjs_auth";

const puppeteerConfig = {
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
};

if (process.env.PUPPETEER_EXECUTABLE_PATH?.trim()) {
  puppeteerConfig.executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH.trim();
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: puppeteerConfig,
});

let initialized = false;
let ready = false;
let reconnecting = false;

const initializeWhatsApp = async () => {
  if (initialized) return;
  initialized = true;
  await client.initialize();
};

client.on("qr", (qr) => {
  console.log("Escanea este QR de WhatsApp:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  ready = true;
  reconnecting = false;
  console.log("WhatsApp conectado");
});

client.on("authenticated", () => {
  console.log("Sesion de WhatsApp autenticada");
});

client.on("auth_failure", (message) => {
  ready = false;
  console.error("Fallo autenticacion WhatsApp:", message);
});

client.on("disconnected", async (reason) => {
  ready = false;
  console.warn("WhatsApp desconectado:", reason);

  if (reconnecting) return;
  reconnecting = true;

  try {
    await client.destroy();
  } catch (error) {
    console.error("Error al destruir cliente WhatsApp:", error.message);
  }

  setTimeout(async () => {
    try {
      await client.initialize();
      reconnecting = false;
    } catch (error) {
      reconnecting = false;
      console.error("Error al reconectar WhatsApp:", error.message);
    }
  }, 5000);
});

client.on("message", async (msg) => {
  try {
    if (msg.from?.includes("@g.us")) return;
    if (msg.from?.includes("@broadcast")) return;
    if (msg.fromMe) return;

    const consulta = String(msg.body || "").trim();
    if (!consulta) return;

    const comando = consulta
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();

    const respuestaComando = await manejarComandoBot(msg.from, consulta);
    if (respuestaComando) {
      await msg.reply(respuestaComando);
      console.log(`[WhatsApp] Comando bot aplicado para ${msg.from}`);
      return;
    }

    if (comando === "MI RESUMEN") {
      const usuario = await buscarPorWhatsapp(msg.from);
      if (!usuario) {
        await msg.reply(
          "Primero necesitamos completar tu perfil. Responde las preguntas de onboarding para habilitar tu resumen diario."
        );
        return;
      }
      const generado = await generarResumen(usuario.id);
      await msg.reply(generado.texto);
      console.log(`[WhatsApp] Resumen manual enviado a ${msg.from}`);
      return;
    }

    const botActivo = await obtenerEstadoBot(msg.from);
    if (!botActivo) {
      console.log(
        `[WhatsApp] Consulta ignorada por bot pausado en chat ${msg.from}`
      );
      return;
    }

    const onboarding = await gestionarOnboarding(msg.from, consulta);
    if (onboarding.enOnboarding) {
      await msg.reply(onboarding.respuesta);
      console.log(`[WhatsApp] Onboarding en curso para ${msg.from}`);
      return;
    }

    console.log(`[WhatsApp] Consulta recibida de ${msg.from}: ${consulta}`);
    const respuesta = await procesarConsulta(msg.from, consulta);
    await msg.reply(respuesta);
    console.log(`[WhatsApp] Respuesta enviada a ${msg.from}`);
  } catch (error) {
    console.error("[WhatsApp] Error procesando consulta:", error.message);
    try {
      await msg.reply(
        "No pude procesar tu consulta en este momento. Probá nuevamente en unos minutos."
      );
    } catch (replyError) {
      console.error(
        "[WhatsApp] Error enviando mensaje de fallback:",
        replyError.message
      );
    }
  }
});

const sendMessage = async (numero, mensaje) => {
  if (!numero) {
    throw new Error("Numero requerido para sendMessage");
  }
  const numeroLimpio = String(numero).replace(/\D/g, "");
  if (!numeroLimpio) {
    throw new Error("Numero invalido");
  }
  if (!mensaje || !String(mensaje).trim()) {
    throw new Error("Mensaje vacio");
  }
  if (!ready) {
    throw new Error("Cliente de WhatsApp no esta listo aun");
  }

  // Algunos numeros resuelven a @lid en lugar de @c.us.
  const numberId = await client.getNumberId(numeroLimpio);
  if (!numberId?._serialized) {
    throw new Error("Numero no registrado en WhatsApp");
  }
  return client.sendMessage(numberId._serialized, String(mensaje));
};

module.exports = {
  client,
  initializeWhatsApp,
  sendMessage,
};
