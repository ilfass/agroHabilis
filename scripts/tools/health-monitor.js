const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { enviarAlertaSistema } = require("../../src/services/alertas_sistema");

const STATUS_FILE = path.join(__dirname, "..", "..", ".wwebjs_auth", ".health_monitor_state");

const readState = () => {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    }
  } catch (_) {}
  return { lastAlertTime: 0, lastStatus: "ok" };
};

const writeState = (state) => {
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (_) {}
};

const runCheck = async () => {
  console.log("[HealthMonitor] Iniciando chequeo de salud cron...");
  const state = readState();
  const ahora = Date.now();
  const COOLDOWN_MS = 60 * 60 * 1000; // 1 hora de cooldown para alertas externas de caída

  let errorMsg = null;
  let isDown = false;
  let whatsappState = null;

  try {
    const res = await axios.get("http://127.0.0.1:3000/api/dashboard/admin/resumen", {
      headers: { "x-admin-key": process.env.ADMIN_KEY },
      timeout: 10000,
    });
    const data = res.data?.data;
    whatsappState = data?.estado?.whatsapp;
  } catch (err) {
    isDown = true;
    errorMsg = err.message;
  }

  if (isDown) {
    console.error(`[HealthMonitor] SERVIDOR CAÍDO: ${errorMsg}`);
    if (state.lastStatus !== "down" || ahora - state.lastAlertTime > COOLDOWN_MS) {
      await enviarAlertaSistema({
        titulo: "🚨 CRÍTICO: El servidor de AgroHabilis está CAÍDO",
        mensaje: `El puerto 3000 del backend no responde.\nDetalle del error: ${errorMsg}\n\nEs de vital importancia reiniciar el proceso vía PM2 (pm2 restart agrohabilis) ingresando a la VPS.`,
        ignorarCooldown: true, // Manejado por el cooldown de este script
      });
      writeState({ lastAlertTime: ahora, lastStatus: "down" });
    }
  } else if (whatsappState !== "listo") {
    console.warn(`[HealthMonitor] WHATSAPP FUERA DE LÍNEA: Estado: ${whatsappState}`);
    
    const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutos de tolerancia para reconexión automática
    const unhealthySince = state.unhealthySince || ahora;
    const timeUnhealthy = ahora - unhealthySince;

    if (timeUnhealthy < GRACE_PERIOD_MS) {
      console.log(`[HealthMonitor] WhatsApp no está listo, pero está dentro del período de tolerancia (${Math.round(timeUnhealthy / 1000)}s / ${GRACE_PERIOD_MS / 1000}s). No se envía alerta.`);
      writeState({
        ...state,
        unhealthySince
      });
    } else {
      const targetStatus = `wa_down_${whatsappState}`;
      if (state.lastStatus !== targetStatus || ahora - state.lastAlertTime > COOLDOWN_MS) {
        await enviarAlertaSistema({
          titulo: `⚠️ ALERTA: Agente de WhatsApp desconectado (${whatsappState || "desconocido"})`,
          mensaje: `El servidor de AgroHabilis está en línea pero el agente de WhatsApp no está conectado hace más de ${Math.round(GRACE_PERIOD_MS / 60000)} minutos.\nEstado reportado: "${whatsappState || "desconocido"}"\n\nPor favor, ingrese al panel de administración para escanear el código QR si la sesión expiró.`,
          ignorarCooldown: true,
        });
        writeState({
          lastAlertTime: ahora,
          lastStatus: targetStatus,
          unhealthySince,
          alertSent: true
        });
      }
    }
  } else {
    console.log("[HealthMonitor] Todo OK. Servidor en línea y WhatsApp Conectado.");
    if (state.lastStatus !== "ok") {
      // Solo notificar recuperación si efectivamente se había enviado una alerta
      if (state.alertSent) {
        await enviarAlertaSistema({
          titulo: "✅ SERVICIO RECUPERADO: AgroHabilis y WhatsApp en línea",
          mensaje: "El servidor de AgroHabilis y el agente de WhatsApp se han restablecido correctamente y vuelven a estar 100% operativos.",
          ignorarCooldown: true,
        });
      }
      writeState({ lastAlertTime: ahora, lastStatus: "ok" });
    }
  }
};

runCheck().catch((err) => {
  console.error("[HealthMonitor] Error fatal en chequeo:", err);
});
