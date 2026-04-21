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
let estadoConexion = "inicializando";
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

const initializeWhatsApp = async () => {
  if (initialized) return;
  initialized = true;
  estadoConexion = "inicializando";
  await client.initialize();
};

const estaListo = () => ready;

const obtenerEstadoWhatsapp = () => {
  if (ready) return "listo";
  return estadoConexion;
};

const esperarClienteListo = async (timeoutMs = 60_000) => {
  if (ready) return true;

  await new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };

    const onDisconnected = () => {
      // no reject inmediato: dejamos que pueda reconectar dentro del timeout
    };

    const onAuthFailure = (message) => {
      cleanup();
      reject(new Error(`Fallo autenticacion WhatsApp: ${message}`));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          "Timeout esperando cliente WhatsApp listo (60s). Revisar QR/sesion."
        )
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("disconnected", onDisconnected);
      client.off("auth_failure", onAuthFailure);
    };

    client.on("ready", onReady);
    client.on("disconnected", onDisconnected);
    client.on("auth_failure", onAuthFailure);
  });

  return true;
};

client.on("qr", (qr) => {
  estadoConexion = "inicializando";
  console.log("Escanea este QR de WhatsApp:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  ready = true;
  estadoConexion = "listo";
  reconnectAttempts = 0;
  console.log("WhatsApp conectado");
});

client.on("authenticated", () => {
  console.log("Sesion de WhatsApp autenticada");
});

client.on("auth_failure", (message) => {
  ready = false;
  estadoConexion = "desconectado";
  console.error("Fallo autenticacion WhatsApp:", message);
});

client.on("disconnected", async (reason) => {
  ready = false;
  estadoConexion = "desconectado";
  console.warn("WhatsApp desconectado:", reason);

  const intentarReconectar = async (attempt = 1) => {
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WhatsApp] Error crítico: no se pudo reconectar tras ${MAX_RECONNECT_ATTEMPTS} intentos.`
      );
      return;
    }

    reconnectAttempts = attempt;
    estadoConexion = "inicializando";
    console.log(`[WhatsApp] Reconexion intento ${attempt}/${MAX_RECONNECT_ATTEMPTS}...`);

    try {
      await client.initialize();
      console.log("[WhatsApp] Reconexion solicitada correctamente.");
    } catch (error) {
      console.error(
        `[WhatsApp] Error al reconectar (intento ${attempt}):`,
        error.message
      );
      setTimeout(() => {
        intentarReconectar(attempt + 1);
      }, 5000);
    }
  };

  setTimeout(() => {
    intentarReconectar(1);
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
    try {
      await esperarClienteListo(60_000);
    } catch (error) {
      console.error("[WhatsApp] Timeout/espera fallida antes de enviar:", error.message);
      throw new Error(
        "Cliente de WhatsApp no está listo para enviar. Reintentá en unos segundos o revisá la sesión QR en VPS."
      );
    }
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
  estaListo,
  initializeWhatsApp,
  obtenerEstadoWhatsapp,
  esperarClienteListo,
  sendMessage,
};
