const nodemailer = require("nodemailer");
const axios = require("axios");

let ultimaNotificacionMs = 0;
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos de cooldown para evitar inundación de notificaciones

/**
 * Envía una alerta del sistema al administrador por email y/o SMS/WhatsApp si están configurados en el .env.
 * 
 * @param {object} params
 * @param {string} params.titulo Título/Asunto de la alerta.
 * @param {string} params.mensaje Cuerpo del mensaje.
 * @param {boolean} [params.ignorarCooldown=false] Si es true, ignora el cooldown de 30 minutos.
 */
const enviarAlertaSistema = async ({ titulo, mensaje, ignorarCooldown = false }) => {
  const ahora = Date.now();
  if (!ignorarCooldown && ahora - ultimaNotificacionMs < COOLDOWN_MS) {
    console.log(`[AlertasSistema] Alerta omitida por cooldown de 30 min: ${titulo}`);
    return;
  }
  ultimaNotificacionMs = ahora;

  console.log(`[AlertasSistema] Procesando alerta: "${titulo}"`);

  const emailDestino = process.env.ALERTAS_EMAIL_DESTINO || "fa07fa@gmail.com";
  const tlfDestino = process.env.ALERTAS_WHATSAPP_SMS_DESTINO || "5492494468949";

  // 1. Envío por Email (SMTP con nodemailer)
  const host = process.env.SMTP_HOST?.trim();
  const port = process.env.SMTP_PORT?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || `"AgroHabilis Alertas" <alertas@habilispro.com>`;

  if (host && port && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: process.env.SMTP_SECURE === "true" || Number(port) === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to: emailDestino,
        subject: titulo,
        text: mensaje,
        html: `<p><strong>${titulo}</strong></p><p>${mensaje.replace(/\n/g, "<br>")}</p><hr><p><small>Este es un mensaje automático del sistema de monitoreo de AgroHabilis.</small></p>`,
      });
      console.log(`[AlertasSistema][Email] Enviado correctamente a ${emailDestino}`);
    } catch (err) {
      console.error(`[AlertasSistema][Email] Error enviando correo:`, err.message);
    }
  } else {
    console.log("[AlertasSistema][Email] Omitido: Falta configurar SMTP_HOST, SMTP_PORT, SMTP_USER o SMTP_PASS en .env");
  }

  // 2. Envío por SMS / WhatsApp vía Twilio API directo
  const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const twilioFrom = process.env.TWILIO_FROM_NUMBER?.trim();

  if (twilioSid && twilioToken && twilioFrom) {
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");

      const esWhatsApp = twilioFrom.startsWith("whatsapp:");
      const targetNumber = esWhatsApp ? `whatsapp:${tlfDestino}` : tlfDestino;

      const params = new URLSearchParams();
      params.append("To", targetNumber);
      params.append("From", twilioFrom);
      params.append("Body", `${titulo}\n\n${mensaje}`);

      const { data } = await axios.post(twilioUrl, params, {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 8000,
      });

      console.log(`[AlertasSistema][Twilio] Mensaje enviado (${data.sid}) a ${targetNumber}`);
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      console.error(`[AlertasSistema][Twilio] Error enviando SMS/WhatsApp:`, errorMsg);
    }
  } else {
    console.log("[AlertasSistema][Twilio] Omitido: Falta configurar TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN o TWILIO_FROM_NUMBER en .env");
  }

  // 3. Envío por Telegram (100% gratuito)
  const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (tgToken && tgChatId) {
    try {
      const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;
      const htmlText = `<b>${titulo}</b>\n\n${mensaje}`;

      await axios.post(tgUrl, {
        chat_id: tgChatId,
        text: htmlText,
        parse_mode: "HTML"
      }, {
        timeout: 8000
      });
      console.log("[AlertasSistema][Telegram] Alerta enviada correctamente.");
    } catch (err) {
      const errorMsg = err.response?.data?.description || err.message;
      console.error("[AlertasSistema][Telegram] Error enviando alerta:", errorMsg);
    }
  } else {
    console.log("[AlertasSistema][Telegram] Omitido: Falta configurar TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en .env");
  }
};

module.exports = {
  enviarAlertaSistema,
};
