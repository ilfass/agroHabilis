const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

const sessionPath = process.env.WHATSAPP_SESSION_PATH || "./.wwebjs_auth";

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
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

  const chatId = `${numeroLimpio}@c.us`;
  return client.sendMessage(chatId, String(mensaje));
};

module.exports = {
  client,
  initializeWhatsApp,
  sendMessage,
};
