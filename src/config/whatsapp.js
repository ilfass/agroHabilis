const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { query } = require("./database");
const {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
} = require("../services/consultas");
const { gestionarOnboarding } = require("../services/onboarding");
const { generarResumen } = require("../services/resumen");
const { buscarPorWhatsapp } = require("../models/usuario");
const {
  configurarAlerta,
  listarAlertas,
  cancelarAlerta,
} = require("../services/alertas");
const {
  registrarGasto,
  registrarVenta,
  obtenerTextoMisGastos,
  obtenerTextoMisVentas,
  obtenerTextoMiMargen,
} = require("../services/gastos");

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

const normalizarNumero = (valor = "") => String(valor).replace(/\D/g, "");

const obtenerAdminsWhatsapp = () => {
  const desdeLista = String(process.env.WHATSAPP_ADMIN_NUMBERS || "")
    .split(",")
    .map((n) => normalizarNumero(n))
    .filter(Boolean);
  const destino = normalizarNumero(process.env.WHATSAPP_DESTINO || "");
  if (destino) desdeLista.push(destino);
  return Array.from(new Set(desdeLista));
};

const esAdminWhatsapp = (from) => {
  const numero = normalizarNumero(from);
  if (!numero) return false;
  return obtenerAdminsWhatsapp().includes(numero);
};

const formatearFecha = (valor) => {
  if (!valor) return "s/d";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return String(valor);
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
};

const estadoProveedorIA = () => {
  const disponibles = [];
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    disponibles.push(`OpenRouter(${process.env.OPENROUTER_MODEL || "openrouter/free"})`);
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    disponibles.push(`Groq(${process.env.GROQ_MODEL || "llama-3.1-8b-instant"})`);
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    disponibles.push(`Gemini(${process.env.GEMINI_MODEL || "gemini-2.0-flash"})`);
  }
  if (!disponibles.length) return "sin proveedores configurados";
  return disponibles.join(" -> ");
};

const obtenerEstadoSistemaTexto = async () => {
  const [ultimaRecoleccion, ultimaCotizacion, ultimaConsulta, dbNow, usuarios, planes] =
    await Promise.all([
      query("SELECT MAX(creado_en) AS ts FROM precios"),
      query("SELECT MAX(fecha) AS fecha FROM tipo_cambio"),
      query("SELECT MAX(creado_en) AS ts FROM historial_consultas"),
      query("SELECT NOW() AS now"),
      query(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE activo = true)::int AS activos
          FROM usuarios
        `
      ),
      query(
        `
          SELECT plan, COUNT(*)::int AS total
          FROM usuarios
          GROUP BY plan
          ORDER BY total DESC
        `
      ),
    ]);

  const dbOk = Boolean(dbNow.rows[0]?.now);
  const resumenPlanes = planes.rows.length
    ? planes.rows.map((p) => `${p.plan || "sin_plan"}:${p.total}`).join(", ")
    : "sin usuarios";

  return [
    "📊 *Estado AgroHabilis*",
    `- WhatsApp: ${obtenerEstadoWhatsapp()}`,
    `- IA (orden): ${estadoProveedorIA()}`,
    `- Base de datos: ${dbOk ? "OK" : "ERROR"}`,
    `- DB time: ${formatearFecha(dbNow.rows[0]?.now)}`,
    `- Última recolección precios: ${formatearFecha(ultimaRecoleccion.rows[0]?.ts)}`,
    `- Último tipo de cambio: ${formatearFecha(ultimaCotizacion.rows[0]?.fecha)}`,
    `- Última consulta recibida: ${formatearFecha(ultimaConsulta.rows[0]?.ts)}`,
    `- Usuarios registrados: ${usuarios.rows[0]?.total || 0}`,
    `- Usuarios activos: ${usuarios.rows[0]?.activos || 0}`,
    `- Planes: ${resumenPlanes}`,
  ].join("\n");
};

const responderComandoAdmin = async (from, comando) => {
  const cmd = String(comando || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (!["ESTADO", "ESTADO SISTEMA", "ESTADO IA", "ESTADO DB", "USUARIOS"].includes(cmd)) {
    return null;
  }
  if (!esAdminWhatsapp(from)) {
    return "Este comando es solo para administradores.";
  }

  if (cmd === "ESTADO IA") {
    return `🧠 IA (orden de fallback): ${estadoProveedorIA()}`;
  }

  if (cmd === "ESTADO DB") {
    const db = await query("SELECT NOW() AS now");
    const ultimaRecoleccion = await query("SELECT MAX(creado_en) AS ts FROM precios");
    return [
      "🗄️ Estado DB",
      `- Conexión: ${db.rows[0]?.now ? "OK" : "ERROR"}`,
      `- Hora DB: ${formatearFecha(db.rows[0]?.now)}`,
      `- Última actualización precios: ${formatearFecha(ultimaRecoleccion.rows[0]?.ts)}`,
    ].join("\n");
  }

  if (cmd === "USUARIOS") {
    const usuarios = await query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE activo = true)::int AS activos
        FROM usuarios
      `
    );
    const ultimos = await query(
      `
        SELECT nombre, whatsapp, activo, creado_en
        FROM usuarios
        ORDER BY creado_en DESC
        LIMIT 5
      `
    );
    const lista =
      ultimos.rows
        .map(
          (u) =>
            `- ${u.nombre || "sin_nombre"} (${u.whatsapp}) ${u.activo ? "activo" : "inactivo"}`
        )
        .join("\n") || "- Sin registros";
    return [
      "👥 Usuarios",
      `- Registrados: ${usuarios.rows[0]?.total || 0}`,
      `- Activos: ${usuarios.rows[0]?.activos || 0}`,
      "- Últimos 5:",
      lista,
    ].join("\n");
  }

  return obtenerEstadoSistemaTexto();
};

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

    const respuestaAdmin = await responderComandoAdmin(msg.from, comando);
    if (respuestaAdmin) {
      await msg.reply(respuestaAdmin);
      console.log(`[WhatsApp] Comando admin aplicado para ${msg.from}: ${comando}`);
      return;
    }

    const respuestaComando = await manejarComandoBot(msg.from, consulta);
    if (respuestaComando) {
      await msg.reply(respuestaComando);
      console.log(`[WhatsApp] Comando bot aplicado para ${msg.from}`);
      return;
    }

    if (comando === "MIS ALERTAS") {
      const r = await listarAlertas(msg.from);
      await msg.reply(r);
      return;
    }

    if (comando.startsWith("CANCELAR ALERTA")) {
      const id = consulta.match(/(\d+)/)?.[1];
      const r = await cancelarAlerta(msg.from, id);
      await msg.reply(r);
      return;
    }

    if (comando.startsWith("ALERTA") || comando.startsWith("AVISAME")) {
      const r = await configurarAlerta(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (
      comando.startsWith("GASTE") ||
      comando.startsWith("GASTÉ") ||
      comando.startsWith("COMPRE") ||
      comando.startsWith("COMPRÉ")
    ) {
      const r = await registrarGasto(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (comando.startsWith("VENDI") || comando.startsWith("VENDÍ")) {
      const r = await registrarVenta(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (comando === "MIS GASTOS") {
      const r = await obtenerTextoMisGastos(msg.from);
      await msg.reply(r);
      return;
    }

    if (comando === "MIS VENTAS") {
      const r = await obtenerTextoMisVentas(msg.from);
      await msg.reply(r);
      return;
    }

    if (comando === "MI MARGEN") {
      const r = await obtenerTextoMiMargen(msg.from);
      await msg.reply(r);
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
