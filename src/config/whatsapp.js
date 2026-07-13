const path = require("path");
const fs = require("fs").promises;
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const { Client, LocalAuth, WAState } = require("whatsapp-web.js");
const { query } = require("./database");
const {
  horasFeedbackBroadcastMasivo,
  sqlMasivoAdminRecienteOtroHistorial,
} = require("../utils/historial_broadcast_ventana");
const {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
} = require("../services/consultas");
const { encolarConsultaWhatsapp } = require("../services/agent/queue/tarea_fila");
const { drenarUnaConsultaWhatsapp } = require("../services/agent/queue/drenar_consulta_whatsapp");
const {
  gestionarOnboarding,
  gestionarCompletarPerfil,
} = require("../services/onboarding");
const { renderTemplate } = require("../templates");
const {
  buscarPorWhatsapp,
  registrarIdentidadWhatsapp,
  extraerIdentidadWhatsapp,
  actualizarUsuario,
  guardarCultivosUsuario,
  obtenerPerfil,
  eliminarUsuarioSoft,
  normalizarWhatsapp,
} = require("../models/usuario");
const { guardarConsulta } = require("../models/consulta");
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
const {
  obtenerContextoPlanPorWhatsapp,
  actualizarPlanPorWhatsapp,
  validarCupoConsultasMensual,
  obtenerConfigPlan,
} = require("../services/planes");
const {
  crearLinkSuscripcionParaUsuario,
  cancelarSuscripcionMpPorWhatsapp,
  solicitarCancelacionSuscripcionMpPorWhatsapp,
} = require("../services/mercado_pago");
const { calcularFlete } = require("../services/fletes");
const { fechaISOArgentina } = require("../utils/fecha_ar");
const { enriquecerTextoWhatsApp } = require("../utils/whatsapp_enriquecer");
const {
  normalizarTexto,
  inferirComandoNatural,
  sugerirComandoPorTexto,
  resolverComandoAlias,
  detectarIntencionIA,
  esConsultaMercadoExcluyeRegistroVenta,
  textoParaClasificacionSaludo,
  esSaludoSocialCorto,
  esPreguntaAyudaComandosOMenu,
} = require("../services/whatsapp_intents");
const {
  parseZonas,
  parseCultivos,
  parseEmail,
  esLineaSolamenteCorreo,
  parseGanaderiaEstructurada,
} = require("../services/whatsapp_parsers");
const {
  guardarPerfilGanaderoUsuario,
  upsertPerfilProductivo,
  obtenerTextoPerfilUsuario,
} = require("../services/perfil_usuario");
const {
  resolverCambioPlanConPago,
  mensajeErrorCambioPlan,
} = require("../services/cambio_plan");
const {
  responderComandoAdmin,
  resetOnboardingNumero,
} = require("../services/admin_comandos");
const { generarConPromptLibre } = require("../services/gemini");
const COMANDOS = require("./comandos");
const capturaInteraccion = require("../services/interacciones_captura");
const conversacionEstadoService = require("../services/conversacion_estado");
const resumenInteractivo = require("../services/resumen_interactivo");
const { parseComandoBot } = require("../services/consultas/bot_control");
const { analizarMediaAgro } = require("../services/vision/agro_vision");
const { transcribirAudio } = require("../services/voice/transcription");
const { iniciarProcesadorColaReintentosVision } = require("../services/vision/telemetria_worker");
const { evaluarPromptInjection } = require("../services/agent/guardrails");
/**
 * TurnController (P2#10) — migración gradual del dispatcher.
 *
 * El import de `services/turn_handlers` registra los handlers ya migrados
 * en el `agent/turn_controller`. El flag `AGENT_TURN_CONTROLLER` (OFF por
 * default) decide si se invoca. Cuando está OFF, todo el código viejo de
 * abajo corre igual que siempre.
 */
require("../services/turn_handlers");
const turnController = require("../services/agent/turn_controller");

const parsePositiveInt = (raw, fallback) => {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const envFlagOn = (key, defaultOn = true) => {
  const v = String(process.env[key] ?? "").trim().toLowerCase();
  if (!v) return defaultOn;
  return !["0", "false", "off", "no"].includes(v);
};

const parseComandoFlete = (texto = "") => {
  const m = String(texto || "").match(/^FLETE\s+(.+?)\s+A\s+(.+)$/i);
  if (!m) return null;
  return { origen: m[1].trim(), destino: m[2].trim() };
};

/** Normaliza espacios (incl. NBSP / varios Unicode) para que rutas tipo "MI EMAIL x" no fallen por Typo invisible. */
const normalizarParaComandoRuteo = (texto = "") =>
  String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

const formatearFechasTextoArg = (texto = "") =>
  String(texto || "").replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, (_m, y, mm, dd) => `${dd}/${mm}/${y}`);

const { formatearRespuestaAmigable } = require("../services/whatsapp_textos");

const humanizarSalidaConIA = async ({
  whatsapp,
  mensajeUsuario,
  borrador,
  intencionTipo = null,
}) => {
  const draft = String(borrador || "").trim().slice(0, 3500);
  if (!draft) return draft;
  const tipo = String(intencionTipo || "").toLowerCase();
  if (
    tipo === "saludo" ||
    tipo === "meta_fecha" ||
    tipo === "meta_hora" ||
    tipo === "mensaje_ruido" ||
    tipo === "ayuda_uso" ||
    tipo === "tipo_cambio" ||
    tipo === "no_agro"
  ) {
    return draft;
  }
  const usuarioSaludoSolo = textoParaClasificacionSaludo(String(mensajeUsuario || ""));
  if (esSaludoSocialCorto(usuarioSaludoSolo)) {
    return draft;
  }
  if (esPreguntaAyudaComandosOMenu(String(mensajeUsuario || ""))) {
    return draft;
  }
  if (
    /PLANTILLA\s+(GRATIS|BASICO|BÁSICO|PRO)\b/i.test(draft) ||
    /📦\s*\*PLANTILLA\b/i.test(draft)
  ) {
    // Evitar reescrituras agresivas de layouts completos de planes.
    return draft;
  }
  try {
    const usuario = await obtenerPerfil(whatsapp);
    const hHist = horasFeedbackBroadcastMasivo();
    const filtroHist = sqlMasivoAdminRecienteOtroHistorial(2);
    const historial = await query(
      `
        SELECT pregunta, respuesta, creado_en
        FROM historial_consultas
        WHERE whatsapp = $1
          AND ${filtroHist}
        ORDER BY creado_en DESC
        LIMIT 3
      `,
      [String(whatsapp || "").replace(/\D/g, ""), hHist]
    );
    const system = [
      "Sos AgroHabilis, asistente experto para el productor argentino. Tu tarea es convertir el 'borrador' (datos técnicos) en una respuesta natural y amigable por WhatsApp.",
      "Reglas de oro:",
      "- Respondé como un asistente humano atento, no como un bot rígido.",
      "- No inventes datos, fechas, precios ni fuentes. Respetá el 'borrador' al 100%.",
      "- Conservá los bloques de datos con separadores ━ si el borrador los trae, son útiles para la lectura rápida.",
      "- NO saludes al usuario (no digas 'Hola', '¿Cómo andás?', etc.) si en el 'historial' ves mensajes recientes de hoy. Tratalo directamente como una conversación fluida continua.",
      "- NO uses firmas ni cierres serviciales repetitivos (como 'cualquier cosa me chiflas', 'un abrazo', etc.) en cada respuesta consecutiva. Omitilos en interacciones rápidas e idas y vueltas continuas para sonar 100% humano.",
      "- Solo saludá amigablemente al inicio si es el primer mensaje del día o si el 'historial' está completamente vacío.",
      "- Solo usá cierres serviciales en respuestas complejas, informativas o que den cierre a una consulta.",
      "- No repitas la pregunta del usuario como encabezado.",
      "- Mantené negritas (*) y emojis del borrador si aportan, pero sentite libre de agregar calidez.",
      "- Si el borrador trae errores técnicos (NO_DATA, etc), explicalo amablemente sin lenguaje técnico.",
    ].join("\n");
    let rows = historial.rows || [];
    if (rows.length > 0) {
      const qNorm = String(mensajeUsuario || "").trim().toLowerCase();
      const firstQNorm = String(rows[0].pregunta || "").trim().toLowerCase();
      if (firstQNorm === qNorm || firstQNorm.startsWith(qNorm) || qNorm.startsWith(firstQNorm)) {
        rows = rows.slice(1);
      }
    }
    const user = JSON.stringify(
      {
        fecha_hoy_ar: fechaISOArgentina(),
        usuario: {
          nombre: usuario?.nombre || null,
          zona: `${usuario?.partido || ""}, ${usuario?.provincia || ""}`.trim(),
          plan: usuario?.plan || null,
        },
        mensajeUsuario: String(mensajeUsuario || "").slice(0, 350),
        historial: rows,
        borrador: draft,
      },
      null,
      2
    );
    const out = await generarConPromptLibre({ system, user });
    const txt = String(out?.texto || "").trim();
    if (!txt) return draft;
    if (txt.length > 1500) return draft;
    if (/http(s)?:\/\/\S+/i.test(txt) && !/http(s)?:\/\/\S+/i.test(draft)) return draft;
    return txt;
  } catch (_e) {
    return draft;
  }
};

const logRoute = (from, route, extra = {}) => {
  try {
    const payload = Object.keys(extra || {}).length ? ` ${JSON.stringify(extra)}` : "";
    console.log(`[WhatsApp][Route] from=${from} route=${route}${payload}`);
  } catch (error) {
    console.log(`[WhatsApp][Route] from=${from} route=${route}`);
  }
};

const esConsultaOperativaOnboarding = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return false;
  if (/\bme conviene vender\b|\bconviene vender\b|\bque conviene vender\b/.test(t)) return true;
  if (/lectura r[aá]pida|no me cierr|decidir fino|mezcl\w* fuente|backwardation|carry|spread/.test(t)) return true;
  if (/\bprecio\b.*\bhoy\b|\bcotizacion\b.*\bhoy\b|\bcotizacion\b/.test(t)) return true;
  if (/\bcomo viene\b.*\bcosecha\b|\bcosecha gruesa\b/.test(t)) return true;
  if (/\bclima\b.*\b7 dias\b|\bclima\b.*\bsemana\b/.test(t)) return true;
  if (/\bternero\b|\bhacienda\b|\bganado\b|\bcria\b|\bcría\b/.test(t)) return true;
  return false;
};

const pareceComandoExplicito = (consulta = "", comando = "") => {
  const c = String(comando || "").trim().toUpperCase();
  if (!c) return false;
  const starts = [
    "MI ",
    "MIS ",
    "VER ",
    "QUIERO PLAN ",
    "ALERTA ",
    "AVISAME ",
    "CANCELAR ALERTA",
    "COMPLETAR PERFIL",
    "FLETE ",
    "RESET ONBOARDING",
  ];
  return starts.some((s) => c.startsWith(s));
};

const sessionPath = process.env.WHATSAPP_SESSION_PATH || "./.wwebjs_auth";
const whatsappClientId = process.env.WHATSAPP_CLIENT_ID?.trim() || "agrohabilis";

if (
  !path.isAbsolute(sessionPath) &&
  (process.env.NODE_ENV === "production" ||
    String(process.env.WHATSAPP_WARN_RELATIVE_PATH || "").trim() === "1")
) {
  console.warn(
    "[WhatsApp] WHATSAPP_SESSION_PATH no es absoluta; en VPS conviene /var/lib/agrohabilis/whatsapp-session (ver .env.example)."
  );
}

const whatsappQrMaxRetries = Math.min(
  10000,
  Math.max(1, parsePositiveInt(process.env.WHATSAPP_QR_MAX_RETRIES, 200))
);
const MAX_RECONNECT_ATTEMPTS = Math.min(
  100,
  Math.max(1, parsePositiveInt(process.env.WHATSAPP_MAX_RECONNECT_ATTEMPTS, 10))
);

const absolutizarWhatsappSessionDataPath = () =>
  path.isAbsolute(sessionPath)
    ? sessionPath
    : path.join(process.cwd(), sessionPath);

const resolveWhatsappQrPngPath = () => {
  const raw = process.env.WHATSAPP_QR_PNG_PATH?.trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  return path.join(
    absolutizarWhatsappSessionDataPath(),
    "_whatsapp_linking_qr.png"
  );
};

const escribirQrWhatsappPng = async (qrPayload) => {
  if (!envFlagOn("WHATSAPP_QR_PNG", true)) return null;
  const outPath = resolveWhatsappQrPngPath();
  try {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await QRCode.toFile(outPath, qrPayload, {
      type: "png",
      margin: 2,
      width: 480,
    });
    return outPath;
  } catch (err) {
    console.error("[WhatsApp] No se pudo escribir PNG del QR:", err?.message || err);
    return null;
  }
};

const borrarQrWhatsappPng = async () => {
  if (!envFlagOn("WHATSAPP_QR_PNG", true)) return;
  try {
    await fs.unlink(resolveWhatsappQrPngPath());
  } catch (_err) {
    /* no existe o ya borrado */
  }
};

const puppeteerConfig = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-zygote",
  ],
};

if (process.env.PUPPETEER_EXECUTABLE_PATH?.trim()) {
  puppeteerConfig.executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH.trim();
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: whatsappClientId,
    dataPath: sessionPath,
  }),
  puppeteer: puppeteerConfig,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  takeoverOnConflict: true,
  takeoverTimeoutMs: 0,
  qrMaxRetries: whatsappQrMaxRetries,
  authTimeoutMs: 120000,
});

let initialized = false;
let ready = false;
/** Último estado de la app WA (evento change_state); puede indicar CONNECTED antes/al margen del flag `ready`. */
let ultimoWaState = null;
let estadoConexion = "inicializando";
let reconnectAttempts = 0;
let reconnectInProgress = false;
/** Último motivo de desconexión / fallo (para panel admin). */
let ultimoMotivoWhatsapp = null;

const normalizarNumero = (valor = "") => String(valor).replace(/\D/g, "");

const resolverNumeroRealMensaje = async (msg) => {
  const from = String(msg?.from || "");
  const identidadFrom = extraerIdentidadWhatsapp(from);
  if (!identidadFrom.esLid) {
    return identidadFrom.numero || null;
  }
  try {
    const contact = await msg.getContact();
    const candidatos = [
      contact?.number,
      contact?.userid,
      contact?.phoneNumber,
      contact?.id?._serialized,
      contact?.id?.user,
    ]
      .map((x) => String(x || ""))
      .filter(Boolean);
    for (const c of candidatos) {
      const id = extraerIdentidadWhatsapp(c);
      if (!id.numero || id.numero === identidadFrom.numero) continue;
      if (id.esLid) continue;
      return id.numero;
    }
  } catch (_error) {
    // best effort: en algunos casos whatsapp-web.js no expone el numero real para @lid
  }
  return null;
};

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


const obtenerTextoComandosUsuario = () => {
  const lista = Array.isArray(COMANDOS?.whatsappUsuario) ? COMANDOS.whatsappUsuario : [];
  if (!lista.length) return "No hay comandos configurados por ahora.";
  return [
    "📚 *Comandos disponibles*",
    ...lista.map((c) => `- *${c.comando}*: ${c.descripcion}`),
  ].join("\n");
};

const initializeWhatsApp = async () => {
  if (initialized) return;
  initialized = true;
  estadoConexion = "inicializando";
  await client.initialize();
};

const tieneInfoClienteWweb = () => {
  try {
    const wid = client?.info?.wid;
    if (!wid) return false;
    return Boolean(wid._serialized || wid.user);
  } catch (_e) {
    return false;
  }
};

/** Sesión utilizable (panel + envíos): `ready` del SDK o señales equivalentes en WA Web. */
const sesionWhatsappOperativa = () => {
  if (ready) return true;
  if (ultimoWaState === WAState.CONNECTED) return true;
  return tieneInfoClienteWweb();
};

const estaListo = () => sesionWhatsappOperativa();

const obtenerEstadoWhatsapp = () => {
  return sesionWhatsappOperativa() ? "listo" : estadoConexion;
};

const ETIQUETA_ESTADO_WHATSAPP = {
  listo: "Conectado",
  desconectado: "Desconectado",
  inicializando: "Conectando",
};

const obtenerEstadoWhatsappDetalle = () => {
  const ok = sesionWhatsappOperativa();
  const codigo = ok ? "listo" : estadoConexion;
  return {
    codigo,
    etiqueta: ETIQUETA_ESTADO_WHATSAPP[codigo] || codigo,
    ultimoMotivo: ok ? null : ultimoMotivoWhatsapp,
    /** Diagnóstico: por qué el panel considera «operativo» sin depender solo de `ready`. */
    operativoDetalle: {
      readyFlag: ready,
      waState: ultimoWaState,
      tieneClientInfo: tieneInfoClienteWweb(),
    },
  };
};

const esperarClienteListo = async (timeoutMs = 60_000) => {
  if (sesionWhatsappOperativa()) return true;

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(arg);
    };

    const onReady = () => finish(resolve);

    const onDisconnected = () => {
      // no reject inmediato: dejamos que pueda reconectar dentro del timeout
    };

    const onAuthFailure = (message) => {
      finish(reject, new Error(`Fallo autenticacion WhatsApp: ${message}`));
    };

    const onChangeState = () => {
      if (sesionWhatsappOperativa()) finish(resolve);
    };

    const timer = setTimeout(() => {
      finish(
        reject,
        new Error(
          `Timeout esperando cliente WhatsApp listo (${timeoutMs}ms). Revisar QR/sesion.`
        )
      );
    }, timeoutMs);

    const poll = setInterval(() => {
      if (sesionWhatsappOperativa()) finish(resolve);
    }, 300);

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("disconnected", onDisconnected);
      client.off("auth_failure", onAuthFailure);
      client.off("change_state", onChangeState);
    };

    client.on("ready", onReady);
    client.on("disconnected", onDisconnected);
    client.on("auth_failure", onAuthFailure);
    client.on("change_state", onChangeState);
  });

  return true;
};

client.on("change_state", (state) => {
  ultimoWaState = state;
});

client.on("qr", (qr) => {
  estadoConexion = "inicializando";
  const qrTerminalSmall =
    String(process.env.WHATSAPP_QR_TERMINAL_SMALL || "").trim() === "1";
  console.log("Escanea este QR de WhatsApp (terminal):");
  qrcode.generate(qr, { small: qrTerminalSmall });
  void escribirQrWhatsappPng(qr).then((pngPath) => {
    if (!pngPath) return;
    console.log(
      `[WhatsApp] QR PNG en disco (no se sirve por HTTP): ${pngPath}`
    );
  });
});

client.on("auth_failure", (message) => {
  ready = false;
  ultimoWaState = null;
  estadoConexion = "desconectado";
  ultimoMotivoWhatsapp = `auth_failure: ${String(message || "").slice(0, 200)}`;
  console.error("Fallo autenticacion WhatsApp:", message);

  const { enviarAlertaSistema } = require("../services/alertas_sistema");
  enviarAlertaSistema({
    titulo: "⚠️ Alerta AgroHabilis: Fallo de autenticación en WhatsApp",
    mensaje: `El cliente de WhatsApp no pudo autenticarse.\nDetalle: ${message}\n\nPor favor, revise el estado del servidor VPS.`
  }).catch(err => console.error("Error enviando alerta de sistema:", err));
});

client.on("disconnected", async (reason) => {
  ready = false;
  ultimoWaState = null;
  estadoConexion = "desconectado";
  ultimoMotivoWhatsapp = String(reason || "").slice(0, 300) || "desconocido";
  console.warn("WhatsApp desconectado:", reason);

  const { enviarAlertaSistema } = require("../services/alertas_sistema");
  enviarAlertaSistema({
    titulo: "⚠️ Alerta AgroHabilis: WhatsApp Desconectado",
    mensaje: `El cliente de WhatsApp se ha desconectado.\nDetalle/Motivo: ${reason || "desconocido"}\n\nEl sistema intentará reconectar automáticamente.`
  }).catch(err => console.error("Error enviando alerta de sistema:", err));

  if (reconnectInProgress) {
    console.log("[WhatsApp] Reconexion ya en progreso, se omite intento duplicado.");
    return;
  }

  const intentarReconectar = async (attempt = 1) => {
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WhatsApp] Error crítico: no se pudo reconectar tras ${MAX_RECONNECT_ATTEMPTS} intentos.`
      );

      enviarAlertaSistema({
        titulo: "🚨 Alerta Crítica AgroHabilis: Falló Reconexión de WhatsApp",
        mensaje: `El cliente de WhatsApp se desconectó y falló al intentar reconectarse tras ${MAX_RECONNECT_ATTEMPTS} intentos.\n\nEs necesario intervenir de forma manual ingresando a la VPS y reiniciando el servicio, o escaneando un nuevo código QR en caso de que la sesión haya expirado.`,
        ignorarCooldown: true
      }).catch(err => console.error("Error enviando alerta de sistema:", err));

      return;
    }

    reconnectAttempts = attempt;
    reconnectInProgress = true;
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
      reconnectInProgress = false;
      setTimeout(() => {
        intentarReconectar(attempt + 1);
      }, 5000 * attempt);
    }
  };

  setTimeout(() => {
    intentarReconectar(1);
  }, 5000);
});

const procesarMensajeEntranteWhatsapp = async (msg) => {
  try {
    if (msg.from?.includes("@g.us")) return;
    if (msg.from?.includes("@broadcast")) return;
    if (msg.fromMe) return;

    const replyContexto = { intencionTipo: null };

    let consulta = String(msg.body || "").trim();
    let monitorExtractData = null;
    let remateExtractData = null;

    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media && (media.mimetype.startsWith("image/") || media.mimetype === "application/pdf")) {
          const buffer = Buffer.from(media.data, "base64");
          try {
            const { analizarMediaAgroUnificado } = require("../services/vision/agro_vision");
            const resUnificado = await analizarMediaAgroUnificado(buffer, media.mimetype, consulta);
            
            if (resUnificado) {
              if (resUnificado.es_monitor && resUnificado.monitor_datos && resUnificado.monitor_datos.tipo_labor) {
                monitorExtractData = resUnificado.monitor_datos;
                console.log(`[Vision Monitor] Detección exitosa de monitor agrícola (${monitorExtractData.tipo_labor})`);
                if (!consulta) {
                  consulta = "[Monitor Agrícola]";
                }
              } else if (resUnificado.es_remate && resUnificado.remate_datos) {
                remateExtractData = resUnificado.remate_datos;
                console.log(`[Vision Remate] Detección exitosa de remate de hacienda (${remateExtractData.lugar_o_firma || 'Consignataria S/D'})`);
                if (!consulta) {
                  consulta = "[Remate de Hacienda]";
                }
              } else if (resUnificado.transcripcion_general) {
                consulta = `[Análisis de archivo: ${resUnificado.transcripcion_general}] ${consulta}`.trim();
                console.log(`[Vision] Procesado media general ${media.mimetype} para ${msg.from}`);
              }
            }
          } catch (eMedia) {
            const errText = eMedia.message.toLowerCase();
            const isQuotaError = errText.includes("429") || 
                                 errText.includes("spending cap") || 
                                 errText.includes("limit") || 
                                 errText.includes("quota") || 
                                 errText.includes("exhausted") ||
                                 errText.includes("503") ||
                                 errText.includes("unavailable") ||
                                 errText.includes("high demand");

            if (isQuotaError) {
              console.warn(`[Vision] ⚠️ Error de cuota detectado. Guardando en cola de reintentos...`);
              try {
                const numeroReal = await resolverNumeroRealMensaje(msg);
                const planCtx = await obtenerContextoPlanPorWhatsapp(msg.from, numeroReal);
                const usuarioId = planCtx?.usuario?.id;
                if (usuarioId) {
                  await query(`
                    INSERT INTO vision_retry_queue (usuario_id, whatsapp_norm, media_buffer, mime_type, error_mensaje)
                    VALUES ($1, $2, $3, $4, $5)
                  `, [
                    usuarioId,
                    msg.from,
                    buffer,
                    media.mimetype,
                    eMedia.message
                  ]);

                  const retryNotice = `📸 *Recibí tu foto.* En este momento el sistema de telemetría de IA está con alta demanda. La voy a analizar automáticamente en unos minutos y te confirmo el registro.`;
                  await client.sendMessage(msg.from, formatearRespuestaAmigable(retryNotice));
                  return; // Abortar flujo para este mensaje
                }
              } catch (eQueue) {
                console.error("[Vision] Error al encolar reintento:", eQueue.message);
              }
            } else {
              console.error("[Vision Unificado] Fallo en procesamiento multimodal:", eMedia.message);
            }
          }
        } else if (media && (
          media.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          media.mimetype === "application/vnd.ms-excel"
        )) {
          const excelNotice = 
            `📊 *¡Hola! Recibí tu planilla de Excel.* Actualmente no puedo procesar archivos de Excel directamente por este chat.\n\n` +
            `👉 *¿Cómo podemos hacerlo?*\n` +
            `1️⃣ Podés sacarle una *foto nítida* a la planilla o pantalla de tu computadora y mandármela como imagen.\n` +
            `2️⃣ Podés guardarla como *PDF* y enviarme el PDF.\n\n` +
            `¡De esa forma te analizo y guardo todos los datos al instante! 🚜`;
          await msg.reply(formatearRespuestaAmigable(excelNotice));
          return;
        } else if (media && media.mimetype.startsWith("audio/")) {
          const buffer = Buffer.from(media.data, "base64");
          try {
            const transcript = await transcribirAudio(buffer, media.mimetype);
            if (transcript) {
              // Para mensajes de audio: el transcript ES el mensaje completo;
              // no debe mezclarse con el body vacío ni con el contexto de hilo previo
              // de registro para la clasificación de intención.
              consulta = `[Audio transcrito: ${transcript}]`.trim();
              console.log(`[Voice] Audio transcrito para ${msg.from}: ${transcript.slice(0, 50)}...`);
            } else {
              throw new Error("Transcripción vacía");
            }
          } catch (eTrans) {
            console.error("[Voice] Error al transcribir audio de " + msg.from + ":", eTrans.message);
            const avisoAudioFallo = `🎤 *Recibí tu nota de audio,* pero en este momento no logré procesar el sonido correctamente.\n\n` +
                                    `¿Me lo podrías escribir por texto, o probar enviarlo de nuevo en unos minutos?`;
            await client.sendMessage(msg.from, formatearRespuestaAmigable(avisoAudioFallo));
            return; // Abortar flujo de forma segura
          }
        }
      } catch (err) {
        console.warn("[Vision] Fallo procesamiento de media:", err.message);
      }
    }

    if (!consulta) return;
    const numeroReal = await resolverNumeroRealMensaje(msg);
    await registrarIdentidadWhatsapp({
      jid: msg.from,
      whatsappReal: numeroReal,
    });

    const comando = normalizarParaComandoRuteo(consulta);
    const comandoAlias = resolverComandoAlias(comando);
    const planCtx = await obtenerContextoPlanPorWhatsapp(msg.from, numeroReal);

    // Interceptor para Reportes Diarios (Texto o Audio)
    const normalizedText = String(consulta || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const esReporte = normalizedText.startsWith("reporte") || 
                     normalizedText.startsWith("parte diario") || 
                     normalizedText.startsWith("novedades del campo") || 
                     normalizedText.includes("reporte diario");
    
    if (esReporte) {
      const usuarioId = planCtx.usuario?.id;
      if (usuarioId) {
        // Strip out the bracketed audio label if present to make the original text clean
        let textoOriginal = consulta.replace(/^\[Audio transcrito:\s*/i, "").replace(/\]$/, "").trim();
        
        // Use Gemini to improve/format the report
        let textoMejorado = "";
        try {
          const { generarConPromptLibre } = require("../services/gemini");
          const out = await generarConPromptLibre({
            system: "Sos un redactor profesional agropecuario. Tu tarea es estructurar y formalizar las novedades del campo reportadas por el productor o encargado de forma clara, técnica y en formato de 'informe de novedades diario'. Organizalo con secciones/viñetas usando markdown. Mantené todos los datos reales (lotes, animales, cantidades, observaciones, fechas) tal como se reportan, sin omitir ni inventar nada.",
            user: `Reporte original:\n"${textoOriginal}"`
          });
          textoMejorado = String(out?.texto || "").trim();
        } catch (eGemini) {
          console.error("[WhatsApp Reporte] Error al mejorar con IA:", eGemini.message);
          // Fallback to original text if AI fails
          textoMejorado = `### Reporte de Novedades Diario\n\n${textoOriginal}`;
        }

        // Save to database
        await query(`
          INSERT INTO reportes_diarios (usuario_id, texto_original, texto_mejorado)
          VALUES ($1, $2, $3)
        `, [usuarioId, textoOriginal, textoMejorado]);

        const confirmacionMsg = `📝 *¡Listo! Registré tu reporte diario en el Panel Web.* 🚜\n\n` +
                                `El reporte fue procesado y mejorado con IA para que puedas visualizarlo, compartirlo o descargarlo como informe desde la pestaña *Reportes Diarios*.\n\n` +
                                `*Novedades estructuradas:*\n${textoMejorado.slice(0, 400)}${textoMejorado.length > 400 ? '...' : ''}`;
        
        try {
          await guardarConsulta({
            usuarioId,
            whatsapp: waCapturaNorm,
            pregunta: `[Reporte diario registrado: ${textoOriginal.slice(0, 100)}]`,
            respuesta: confirmacionMsg,
            tokensUsados: null,
            iaSinContexto: false,
            iaProvider: "gemini_reportes",
            iaProviderTrace: [{ type: "reporte_diario", success: true }]
          });
        } catch (eGuardar) {
          console.error("[WhatsApp Reporte] Error al registrar en historial_consultas:", eGuardar.message);
        }

        const msgReplyRaw = msg.reply.bind(msg);
        const finalMsg = formatearRespuestaAmigable(confirmacionMsg);
        capturaInteraccion.registrarFireAndForget({
          whatsappNorm: waCapturaNorm,
          usuarioId: planCtx.usuario?.id ?? null,
          direccion: "out",
          cuerpo: finalMsg,
          ruta: "reporte_diario_out",
        });
        await msgReplyRaw(finalMsg);
        return; // Interceptado exitosamente
      }
    }

    // Guardrail conversacional ante Prompt Injection / Jailbreaks
    if (evaluarPromptInjection(consulta)) {
      const warningJailbreak = 
        `⚠️ *Atención*: En AgroHabilis nos enfocamos exclusivamente en la asistencia técnica y gestión de tu establecimiento agropecuario.\n\n` +
        `Para consultar precios, clima, registrar ganado o labores, escribime una consulta sencilla (ej. 'precio soja rosario hoy' o 'registrar 30 vacas').`;
      
      const identCaptura = extraerIdentidadWhatsapp(msg.from);
      const waCapturaNorm = normalizarWhatsapp(numeroReal || identCaptura.numeroReal || identCaptura.numero || "") || "";
      
      capturaInteraccion.registrarFireAndForget({
        whatsappNorm: waCapturaNorm,
        usuarioId: planCtx.usuario?.id ?? null,
        direccion: "in",
        cuerpo: consulta,
        ruta: "guardrail_blocked_in",
      });
      
      const outMsg = formatearRespuestaAmigable(warningJailbreak);
      capturaInteraccion.registrarFireAndForget({
        whatsappNorm: waCapturaNorm,
        usuarioId: planCtx.usuario?.id ?? null,
        direccion: "out",
        cuerpo: outMsg,
        ruta: "guardrail_blocked_out",
      });
      
      await msg.reply(outMsg);
      return;
    }

    const identCaptura = extraerIdentidadWhatsapp(msg.from);
    const waCapturaNorm =
      normalizarWhatsapp(numeroReal || identCaptura.numeroReal || identCaptura.numero || "") || "";

    capturaInteraccion.registrarFireAndForget({
      whatsappNorm: waCapturaNorm,
      usuarioId: planCtx.usuario?.id ?? null,
      direccion: "in",
      cuerpo: consulta,
      ruta: "whatsapp_in",
    });

    const msgReplyRaw = msg.reply.bind(msg);
    const emitCapturaSalida = (cuerpoFinal, ruta) => {
      capturaInteraccion.registrarFireAndForget({
        whatsappNorm: waCapturaNorm,
        usuarioId: planCtx.usuario?.id ?? null,
        direccion: "out",
        cuerpo: cuerpoFinal,
        ruta: ruta || "whatsapp_out",
      });
    };
    const replySinIA = async (texto, ...args) => {
      const out = formatearRespuestaAmigable(String(texto || ""));
      emitCapturaSalida(out, replyContexto.intencionTipo || "reply_sin_ia");
      return msgReplyRaw(out, ...args);
    };
    msg.reply = async (texto, ...args) => {
      const humanizada = await humanizarSalidaConIA({
        whatsapp: msg.from,
        // Usar consulta (que incluye el transcript del audio si hubo) en lugar de msg.body
        mensajeUsuario: consulta || String(msg.body || ""),
        borrador: String(texto || ""),
        intencionTipo: replyContexto.intencionTipo,
      });
      const final = formatearRespuestaAmigable(String(humanizada || texto || ""));
      emitCapturaSalida(final, replyContexto.intencionTipo || "reply");
      return msgReplyRaw(final, ...args);
    };

    // Interceptor para Registrar Monitor de Maquinaria detectado por Gemini Vision
    if (monitorExtractData) {
      const usuarioId = planCtx.usuario?.id;
      if (usuarioId) {
        await query(`
          INSERT INTO registro_labores_maquinaria 
            (usuario_id, tipo_labor, lote_nombre, hectareas_reales, dosis_promedio, producto_insumo, datos_crudos_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          usuarioId,
          monitorExtractData.tipo_labor,
          monitorExtractData.lote_nombre || 'Establecimiento General',
          monitorExtractData.hectareas_reales,
          monitorExtractData.dosis_promedio,
          monitorExtractData.producto_insumo || 'Insumo',
          JSON.stringify(monitorExtractData)
        ]);

        const emojiMap = {
          SIEMBRA: "🚜",
          COSECHA: "🌾",
          PULVERIZACION: "🌱"
        };
        const emoji = emojiMap[monitorExtractData.tipo_labor] || "🚜";
        
        const fmtNum = (val) => val != null ? Number(val).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : null;
        
        let estDetalles = [];
        if (monitorExtractData.finca_nombre) estDetalles.push(monitorExtractData.finca_nombre);
        if (monitorExtractData.agricultor_nombre) estDetalles.push(monitorExtractData.agricultor_nombre);
        const estStr = estDetalles.length ? estDetalles.join(" · ") : null;

        let lines = [
          `📲 *¡Listo! Registré la labor de tu monitor agrícola:*`,
          ``,
          `* **Operación**: ${monitorExtractData.tipo_labor} ${emoji}`
        ];

        if (estStr) {
          lines.push(`* **Establecimiento**: ${estStr}`);
        }
        lines.push(`* **Lote**: ${monitorExtractData.lote_nombre || "Establecimiento General"}`);
        lines.push(`* **Superficie**: ${fmtNum(monitorExtractData.hectareas_reales) || "—"} ha reales`);
        lines.push(`* **Insumo**: ${monitorExtractData.producto_insumo || "—"}`);

        const insumoLower = String(monitorExtractData.producto_insumo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const isSemillaDensidad = insumoLower.includes("maiz") || insumoLower.includes("girasol");
        const dosisUnidad = monitorExtractData.tipo_labor === 'SIEMBRA' ? (isSemillaDensidad ? 'sem/ha' : 'kg/ha') : monitorExtractData.tipo_labor === 'PULVERIZACION' ? 'l/ha' : 'tn/ha';
        lines.push(`* **Dosis Promedio**: ${fmtNum(monitorExtractData.dosis_promedio) || "—"} ${dosisUnidad}`);

        if (monitorExtractData.rendimiento_total_t != null) {
          lines.push(`* **Masa Seca Total**: ${fmtNum(monitorExtractData.rendimiento_total_t)} t`);
        }
        if (monitorExtractData.humedad_media != null) {
          lines.push(`* **Humedad Media**: ${fmtNum(monitorExtractData.humedad_media)}%`);
        }
        if (monitorExtractData.velocidad_media != null) {
          lines.push(`* **Velocidad Media**: ${fmtNum(monitorExtractData.velocidad_media)} km/h`);
        }

        lines.push(``);
        lines.push(`_Los datos ya están guardados en tu panel histórico de forma segura._`);

        const confirmationMsg = lines.join("\n");

        try {
          await guardarConsulta({
            usuarioId,
            whatsapp: waCapturaNorm,
            pregunta: "[Imagen de monitor agrícola para extracción Vision]",
            respuesta: confirmationMsg,
            tokensUsados: null,
            iaSinContexto: false,
            iaProvider: "gemini_vision",
            iaProviderTrace: [{ type: "vision_monitor", success: true, data: monitorExtractData }]
          });
        } catch (eGuardar) {
          console.error("[Vision Monitor] Error al registrar en historial_consultas:", eGuardar.message);
        }

        await replySinIA(confirmationMsg);
        return; // Detenemos la ejecución aquí para no procesar el mensaje con IA
      }
    }

    // Interceptor para Registrar Remates de Hacienda detectados por Gemini Vision
    if (remateExtractData) {
      const usuarioId = planCtx.usuario?.id;
      if (usuarioId) {
        // Determinamos la fecha
        let fechaRemate = remateExtractData.fecha;
        if (!fechaRemate || !/^\d{4}-\d{2}-\d{2}$/.test(fechaRemate)) {
          fechaRemate = fechaISOArgentina();
        }

        const lotes = Array.isArray(remateExtractData.lotes) ? remateExtractData.lotes : [];
        const lotesGuardados = [];

        for (const lote of lotes) {
          if (!lote.categoria) continue;
          
          try {
            await query(`
              INSERT INTO precios_hacienda (categoria, precio_promedio, precio_max, precio_min, unidad, fecha)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (categoria, fecha) 
              DO UPDATE SET
                precio_promedio = EXCLUDED.precio_promedio,
                precio_max = EXCLUDED.precio_max,
                precio_min = EXCLUDED.precio_min,
                unidad = EXCLUDED.unidad,
                creado_en = NOW()
            `, [
              lote.categoria,
              lote.precio_promedio != null ? Number(lote.precio_promedio) : null,
              lote.precio_max != null ? Number(lote.precio_max) : null,
              lote.precio_min != null ? Number(lote.precio_min) : null,
              lote.unidad || 'kg',
              fechaRemate
            ]);
            
            lotesGuardados.push(lote);
          } catch (errDb) {
            console.error(`[Vision Remate] Error guardando lote ${lote.categoria}:`, errDb.message);
          }
        }

        const fmtNum = (val) => val != null ? Number(val).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : null;
        
        let lines = [
          `🐮 *¡Listo! Registré los precios del remate de hacienda:*`,
          ``
        ];
        
        if (remateExtractData.lugar_o_firma) {
          lines.push(`* **Firma / Lugar**: ${remateExtractData.lugar_o_firma}`);
        }
        lines.push(`* **Fecha**: ${fechaRemate}`);
        lines.push(``);
        lines.push(`*Lotes registrados:*`);

        if (lotesGuardados.length === 0) {
          lines.push(`_No se pudieron guardar lotes válidos._`);
        } else {
          for (const lote of lotesGuardados) {
            let descLote = `* *${lote.categoria}*: `;
            const preciosDetalle = [];
            if (lote.precio_promedio != null) {
              preciosDetalle.push(`Promedio: $${fmtNum(lote.precio_promedio)}`);
            }
            if (lote.precio_min != null || lote.precio_max != null) {
              preciosDetalle.push(`Rango: $${fmtNum(lote.precio_min || 0)} - $${fmtNum(lote.precio_max || 0)}`);
            }
            descLote += preciosDetalle.join(" · ") + ` por ${lote.unidad || 'kg'}`;
            if (lote.cantidad_cabezas) {
              descLote += ` (${lote.cantidad_cabezas} cabezas`;
              if (lote.peso_promedio) {
                descLote += `, ø ${fmtNum(lote.peso_promedio)} kg`;
              }
              descLote += `)`;
            } else if (lote.peso_promedio) {
              descLote += ` (ø ${fmtNum(lote.peso_promedio)} kg)`;
            }
            lines.push(descLote);
          }
        }

        lines.push(``);
        lines.push(`_Los datos de precios se integraron a tu base de referencia ganadera para consultas de mercado._`);

        const confirmationMsg = lines.join("\n");

        try {
          await guardarConsulta({
            usuarioId,
            whatsapp: waCapturaNorm,
            pregunta: "[Planilla/Pizarra de remate para extracción Vision]",
            respuesta: confirmationMsg,
            tokensUsados: null,
            iaSinContexto: false,
            iaProvider: "gemini_vision",
            iaProviderTrace: [{ type: "vision_remate", success: true, data: remateExtractData }]
          });
        } catch (eGuardar) {
          console.error("[Vision Remate] Error al registrar en historial_consultas:", eGuardar.message);
        }

        await replySinIA(confirmationMsg);
        return; // Detenemos la ejecución aquí para no procesar el mensaje con IA
      }
    }

    // Interceptor de Aceptación de Invitación para Miembros de Equipo (Pendientes)
    if (planCtx.usuario && planCtx.usuario.es_delegado && planCtx.usuario.delegado_pendiente) {
      const respLimpia = String(msg.body || "").trim().toUpperCase();
      if (respLimpia === "SI" || respLimpia === "SÍ" || respLimpia === "ACEPTO") {
        // Aceptó!
        await query(
          `
            UPDATE telefonos_autorizados 
            SET aceptado = true 
            WHERE usuario_principal_id = $1 AND whatsapp_autorizado = $2
          `,
          [planCtx.usuario.id, planCtx.usuario.whatsapp_autorizado]
        );
        // Actualizamos el objeto en memoria para que prosiga si es necesario, o salimos confirmando.
        planCtx.usuario.delegado_pendiente = false;
        
        // Verificar si ya tiene cuenta de usuario principal
        const { variantesTelefono } = require("../services/cliente_auth");
        const variantes = variantesTelefono(planCtx.usuario.whatsapp_autorizado);
        const checkIsAlreadyUser = await query(
          `
            SELECT id FROM usuarios 
            WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = ANY($1::text[])
               OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = ANY($1::text[])
            LIMIT 1
          `,
          [variantes]
        );
        const yaEsUsuario = checkIsAlreadyUser.rows.length > 0;

        const mapRoles = {
          operario: "Operario/Tractorista",
          encargado: "Encargado de Establecimiento",
          socio: "Socio / Co-propietario",
          asesor: "Asesor Técnico / Agrónomo",
          admin: "Administrativo / Contador",
          veterinario: "Veterinario"
        };
        const rolBonito = mapRoles[String(planCtx.usuario.rol_operario).toLowerCase()] || String(planCtx.usuario.rol_operario).toUpperCase();

        let msjExito;
        if (yaEsUsuario) {
          msjExito = `✅ *¡Invitación aceptada!*\n\n` +
            `A partir de ahora formás parte del equipo de *${planCtx.usuario.nombre}* con el rol de *${rolBonito}*.\n\n` +
            `⚠️ *AVISO IMPORTANTE:* Como detectamos que ya tenés una cuenta individual registrada en el sistema, a partir de ahora *ya no vas a poder registrar cosas a tu nombre*.\n\n` +
            `Todos tus registros y consultas en este chat se guardarán directamente *para el campo de ${planCtx.usuario.nombre}* con tu rol específico.\n\n` +
            `Escribile al asistente de forma natural para empezar (ej: "registrá entrada de 10 bolsas de maíz").`;
        } else {
          msjExito = `✅ *¡Invitación aceptada!*\n\n` +
            `A partir de ahora estás autorizado para registrar stock, gastos y movimientos en el establecimiento de *${planCtx.usuario.nombre}* con el rol de *${rolBonito}*.\n\n` +
            `Escribile al asistente de forma natural para empezar (ej: "registrá entrada de 10 bolsas de maíz").`;
        }

        await replySinIA(msjExito);
      } else if (respLimpia === "NO" || respLimpia === "RECHAZO") {
        // Rechazó!
        await query(
          `
            UPDATE telefonos_autorizados 
            SET activo = false 
            WHERE usuario_principal_id = $1 AND whatsapp_autorizado = $2
          `,
          [planCtx.usuario.id, planCtx.usuario.whatsapp_autorizado]
        );
        await replySinIA(
          `❌ *Invitación rechazada.*\n\n` +
          `Has rechazado la invitación de *${planCtx.usuario.nombre}*. Si fue un error, el dueño del campo tendrá que volver a agregarte desde el panel.`
        );
      } else {
        // Recordatorio de invitación pendiente
        await replySinIA(
          `⚠️ *Invitación Pendiente* 🌾\n\n` +
          `*${planCtx.usuario.nombre}* te ha invitado a formar parte de su equipo de campo en *AgroHabilis* como *${String(planCtx.usuario.rol_operario).toUpperCase()}*.\n\n` +
          `¿Aceptás esta invitación para poder interactuar con el asistente y guardar datos en su cuenta?\n\n` +
          `Respondé *SI* para confirmar o *NO* para rechazar.`
        );
      }
      return;
    }

    /**
     * P2#10 — TurnController (gradual). Si `AGENT_TURN_CONTROLLER=1` y hay
     * algún handler enchufado que matchea, lo resuelve acá; si no, sigue
     * el flujo viejo de abajo intacto. Con flag OFF (default), retorna
     * `{ manejado: false }` inmediatamente y no cambia comportamiento.
     */
    if (turnController.turnControllerActivo()) {
      try {
        /**
         * `comandoNatural` heurístico (sin LLM, ~0ms) calculado ANTES del
         * TurnController. Antes faltaba en `turnCtx` y handlers como
         * `strict_suggestion`, `cmd_alertas`, `cmd_finanzas`, etc. que lo
         * leían siempre veían `undefined` → matchings rotos y caídas en
         * texto fijo o en flujo legacy.
         */
        const comandoNaturalPre = inferirComandoNatural(consulta) || "";
        const turnCtx = {
          jid: msg.from,
          numeroNormalizado: waCapturaNorm,
          consulta,
          comandoUpper: comando,
          comandoAlias,
          comandoNatural: comandoNaturalPre,
          planCtx,
          replyContexto,
          reply: (texto, ...args) => msg.reply(texto, ...args),
          replySinIA,
          send: (texto) => client.sendMessage(msg.from, texto),
          emitCaptura: emitCapturaSalida,
          esAdmin: esAdminWhatsapp(msg.from),
          getEstadoWhatsapp: obtenerEstadoWhatsapp,
          flags: {
            asyncCola: !["0", "false", "off", "no", ""].includes(
              String(process.env.AGENT_CONSULTA_ASYNC ?? "").trim().toLowerCase()
            ),
          },
        };
        const outTC = await turnController.run(turnCtx);
        /**
         * Trazabilidad estilo Cursor: imprimimos el `turnTrace` cuando hay
         * más de un handler evaluado o cuando el resultado no fue
         * manejado. Esto permite ver en logs qué handlers se evaluaron
         * en cada turno, en qué ms cada uno, y cuál ganó. Si el array
         * está vacío (flag OFF o whitelist vacía) no logueamos nada.
         */
        if (Array.isArray(outTC?.turnTrace) && outTC.turnTrace.length) {
          const traceResumen = outTC.turnTrace
            .map((t) => `${t.id}=${t.ms}ms${t._error ? "[ERR]" : ""}`)
            .join(" → ");
          console.log(
            `[TurnController] from=${msg.from} manejado=${Boolean(outTC?.manejado)} trace: ${traceResumen}${outTC?.route ? ` (route=${outTC.route})` : ""}`
          );
        }
        if (outTC?.manejado) {
          if (outTC.route) logRoute(msg.from, outTC.route, outTC.extraLog || {});
          if (outTC.respuesta != null) {
            /**
             * Si el handler marcó `yaHumanizada` (caso pipeline_agente,
             * que ya pasó por el LLM dentro del pipeline), evitamos un
             * segundo paso por `humanizarSalidaConIA`. Ahorra una LLM
             * call por mensaje y previene reescritura que rompía formato
             * (especialmente bloques con ━ y emojis del template).
             */
            if (outTC.yaHumanizada) {
              await replySinIA(outTC.respuesta);
            } else {
              await msg.reply(outTC.respuesta);
            }
          }
          return;
        }
      } catch (e) {
        console.warn("[WhatsApp][TurnController] error, sigo con flujo viejo:", e?.message || e);
      }
    }

    // 🚨 AUTO-RECUPERACIÓN / RESCATE CONVERSACIONAL ANTE QUEJAS
    const { detectarQuejaUsuario, obtenerUltimaPreguntaFallida, eliminarConsultaHistorial } = require("../services/agent/recuperacion");
    if (!esAdminWhatsapp(msg.from) && detectarQuejaUsuario(consulta)) {
      const waN = normalizarWhatsapp(numeroReal || msg.from) || normalizarWhatsapp(msg.from);
      const ult = await obtenerUltimaPreguntaFallida(waN, planCtx.usuario?.id);
      if (ult) {
        console.log(`[Recuperación] Queja detectada para ${waN}. Rescatando pregunta anterior: "${ult.pregunta.slice(0, 60)}..."`);
        
        // 1. Limpiar el historial conflictivo anterior para que no contamine
        await eliminarConsultaHistorial(ult.id);
        
        // 2. Log de ruta
        logRoute(msg.from, "RECOVERY_FLOW", { preguntaRescatada: ult.pregunta });
        
        // 3. Forzar el uso de premium temporalmente para este turno
        process.env.GEMINI_FORCE_PREMIUM_TURN = "true";
        
        // 4. Re-lanzar el procesamiento del mensaje sobre la pregunta original rescatada
        consulta = ult.pregunta;
        
        // Envolver el msg.reply original para anteponer la disculpa rioplatense
        const originalReply = msg.reply.bind(msg);
        msg.reply = async (texto, ...args) => {
          const disculpa = `Uh, tenés toda la razón, disculpame. Interpreté mal tu mensaje anterior. Ahí lo analicé de nuevo con más detalle:\n\n`;
          const textoConDisculpa = disculpa + texto;
          // Limpiar flag global
          process.env.GEMINI_FORCE_PREMIUM_TURN = "false";
          return originalReply(textoConDisculpa, ...args);
        };
      }
    }

    // Onboarding debe tener prioridad absoluta para evitar caer en IA libre
    // cuando el usuario todavía está completando alta.
    if (!esAdminWhatsapp(msg.from)) {
      const onboarding = await gestionarOnboarding(msg.from, consulta, numeroReal);
      if (onboarding.enOnboarding) {
        logRoute(msg.from, "ONBOARDING_FLOW", { tieneRespuesta: Boolean(onboarding.respuesta) });
        if (onboarding.respuesta) {
          // Onboarding: sin humanizar y sin reply con cita (evita que parezca que se “aceptaron” todas las zonas pegadas).
          const outOnb = formatearRespuestaAmigable(String(onboarding.respuesta));
          await client.sendMessage(msg.from, outOnb);
          capturaInteraccion.registrarFireAndForget({
            whatsappNorm: waCapturaNorm,
            usuarioId: planCtx.usuario?.id ?? null,
            direccion: "out",
            cuerpo: outOnb,
            ruta: "onboarding",
          });
        }
        console.log(`[WhatsApp] Onboarding en curso para ${msg.from}`);
        return;
      }
    }

    // Flujo del cambio de plan (email y confirmación)
    const estadoCambioPlan = await conversacionEstadoService.obtenerEstado(msg.from);
    if (estadoCambioPlan?.flujo === "cambio_plan") {
      const planObjetivo = estadoCambioPlan.contexto?.planObjetivo || "basico";

      if (estadoCambioPlan.paso === "esperando_email") {
        const parsedEmail = parseEmail(consulta.trim());
        if (!parsedEmail) {
          await replySinIA(
            `⚠️ Ese no parece ser un correo electrónico válido.\n\n` +
            `Por favor, ingresá tu correo nuevamente (ej: tucorreo@dominio.com):`
          );
          return;
        }

        // Guardamos el email provisto y pasamos al paso de confirmación
        await conversacionEstadoService.guardarEstado(msg.from, "cambio_plan", "esperando_confirmacion_email", {
          planObjetivo,
          email: parsedEmail
        });

        await replySinIA(
          `¿Confirmás que *${parsedEmail}* es tu correo electrónico correcto?\n\n` +
          `👉 Respondé *SI* para confirmar o escribí otro correo si te equivocaste.`
        );
        return;
      }

      if (estadoCambioPlan.paso === "esperando_confirmacion_email") {
        const confirmacion = consulta.trim().toLowerCase();
        const emailCandidato = estadoCambioPlan.contexto?.email;

        if (["si", "sí", "sii", "siis", "correcto", "ok", "confirmar", "confirmo"].includes(confirmacion)) {
          // 1. Guardar email en el perfil del usuario
          if (planCtx.usuario?.id && emailCandidato) {
            await actualizarUsuario(planCtx.usuario.id, { email: emailCandidato });
            planCtx.usuario.email = emailCandidato; // actualizar contexto en caliente
          }

          await replySinIA(`✅ Email confirmado y guardado. Generando tu link de pago...`);

          // 2. Ejecutar cambio de plan
          try {
            const outPlan = await resolverCambioPlanConPago({
              whatsapp: msg.from,
              planObjetivo,
            });
            await replySinIA(outPlan);
            // 3. Limpiar estado de la conversación
            await conversacionEstadoService.limpiarEstado(msg.from);
          } catch (error) {
            console.error("[WhatsApp] Error cambio de plan tras email:", error.message);
            await replySinIA(mensajeErrorCambioPlan(error));
          }
          return;
        } else {
          // Si el usuario escribe otro correo en lugar de "SI"
          const parsedEmail = parseEmail(consulta.trim());
          if (parsedEmail) {
            await conversacionEstadoService.guardarEstado(msg.from, "cambio_plan", "esperando_confirmacion_email", {
              planObjetivo,
              email: parsedEmail
            });
            await replySinIA(
              `¿Confirmás que *${parsedEmail}* es tu correo electrónico correcto?\n\n` +
              `👉 Respondé *SI* para confirmar o escribí otro correo si te equivocaste.`
            );
          } else {
            await replySinIA(
              `Por favor, respondé *SI* para confirmar que *${emailCandidato}* es tu correo electrónico correcto, o escribí otro correo si te equivocaste.`
            );
          }
          return;
        }
      }
    }

    // Flujo del limite alcanzado
    if (estadoCambioPlan?.flujo === "limite_alcanzado") {
      if (estadoCambioPlan.paso === "esperando_confirmacion_explicacion") {
        const respuestaUsuario = consulta.trim().toLowerCase();
        const afirmativo = ["si", "sí", "sii", "sisi", "dale", "ok", "claro", "bueno", "obvio", "explicame", "como", "cómo", "como hago", "cómo hago"].some(aff => respuestaUsuario.includes(aff));
        const negativo = ["no", "noo", "no gracias", "después", "mas tarde", "más tarde"].some(neg => respuestaUsuario.includes(neg));

        if (afirmativo) {
          await conversacionEstadoService.limpiarEstado(msg.from);

          const configBasico = await obtenerConfigPlan("basico");
          const configPro = await obtenerConfigPlan("pro");

          const nombreUsuario = planCtx.usuario?.nombre ? planCtx.usuario.nombre.split(" ")[0] : "";
          const saludo = nombreUsuario ? `¡Buenísimo, ${nombreUsuario}! ` : `¡Buenísimo! `;

          const mensajeExplicacion = [
            `${saludo}Te cuento cómo es:`,
            ``,
            `Actualmente estás en el *Plan Gratis* (con límite de 25 consultas semanales). Para operar sin límites y registrar toda la actividad de tu campo, tenés estas opciones con suscripción mensual de Mercado Pago:`,
            ``,
            `1️⃣ *Plan Básico*: $${configBasico.precio.toLocaleString("es-AR")}/mes. Incluye hasta ${configBasico.limite_consultas_semanal} consultas y ${configBasico.limite_audios_semanal} audios semanales.`,
            `2️⃣ *Plan Pro*: $${configPro.precio.toLocaleString("es-AR")}/mes. Incluye hasta ${configPro.limite_consultas_semanal} consultas y ${configPro.limite_audios_semanal} audios semanales.`,
            `3️⃣ *Plan Pro Max*: consultas e imágenes 100% ilimitadas.`,
            ``,
            `👉 *¿Cómo seguimos?*`,
            `Si querés pasarte al Básico, simplemente escribí: *QUIERO PLAN BASICO*`,
            `Si preferís el Pro, escribí: *QUIERO PLAN PRO*`,
            `O si querés ver más detalles de cada plan, escribí: *MI PLAN*`,
            ``,
            `¿Con cuál preferís arrancar?`
          ].join("\n");

          await replySinIA(mensajeExplicacion);
          return;
        } else if (negativo) {
          await conversacionEstadoService.limpiarEstado(msg.from);
          const nombreUsuario = planCtx.usuario?.nombre ? `, ${planCtx.usuario.nombre.split(" ")[0]}` : "";
          await replySinIA(`Entendido${nombreUsuario}. Si en algún momento querés sumarte a un plan superior para seguir cargando datos, acá voy a estar. ¡Un abrazo!`);
          return;
        } else {
          await conversacionEstadoService.limpiarEstado(msg.from);
        }
      }
    }

    const pareceComandoPrioridadResumen =
      /^(QUIERO\s+PLAN|VER\s+COMANDO|VER\s+COMANDOS|MI\s+PLAN\b|DETENER\s+RESUMEN|BORRAR|ELIMINAR|MIS\s+|MI\s+EMAIL\b|MI\s+RESUMEN\b)/i.test(
        consulta.trim()
      ) || /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\s*$/i.test(consulta.trim());

    if (!pareceComandoPrioridadResumen && !esAdminWhatsapp(msg.from)) {
      const waN =
        normalizarWhatsapp(numeroReal || msg.from) || normalizarWhatsapp(msg.from);
      let waClaveEstado = waN;
      let est = await conversacionEstadoService.obtenerEstado(waClaveEstado);
      if (est?.flujo !== "resumen_interactivo" && planCtx.usuario?.id) {
        const porUsuario =
          await conversacionEstadoService.obtenerEstadoResumenInteractivoPorUsuarioId(
            planCtx.usuario.id
          );
        if (porUsuario) {
          est = porUsuario;
          const k = String(porUsuario.whatsapp || "").replace(/\D/g, "");
          if (k) waClaveEstado = k;
        }
      }
      if (est?.flujo === "resumen_interactivo") {
        const enviarResumenI = async (texto) => {
          const out = formatearRespuestaAmigable(String(texto || ""));
          await client.sendMessage(msg.from, out);
          capturaInteraccion.registrarFireAndForget({
            whatsappNorm: waCapturaNorm,
            usuarioId: planCtx.usuario?.id ?? null,
            direccion: "out",
            cuerpo: out,
            ruta: "resumen_interactivo",
          });
        };
        const manejado = await resumenInteractivo.procesarRespuestaResumen({
          whatsapp: waClaveEstado,
          mensaje: consulta,
          enviar: enviarResumenI,
        });
        if (manejado) {
          logRoute(msg.from, "RESUMEN_INTERACTIVO");
          return;
        }
      }
    }

    // Pedido coloquial ("me pasás al plan Pro?", etc.) antes de detectarIntencionIA: si no, Gemini suele
    // devolver PLANES y comandoNatural pasa a MI PLAN, sin link de MP.
    const pedidoPlanHeuristico = inferirComandoNatural(consulta);
    if (
      pedidoPlanHeuristico === "QUIERO PLAN PRO" ||
      pedidoPlanHeuristico === "QUIERO PLAN BASICO" ||
      pedidoPlanHeuristico === "QUIERO PLAN GRATIS" ||
      pedidoPlanHeuristico === "QUIERO PLAN PRO MAX" ||
      pedidoPlanHeuristico === "QUIERO PLAN PROMAX"
    ) {
      logRoute(msg.from, "CMD_PLAN_NATURAL_TEMPRANO", { natural: pedidoPlanHeuristico });
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivoTemprano =
        pedidoPlanHeuristico.endsWith("PRO MAX") || pedidoPlanHeuristico.endsWith("PROMAX")
          ? "pro_max"
          : pedidoPlanHeuristico.endsWith("PRO")
          ? "pro"
          : pedidoPlanHeuristico.endsWith("BASICO")
          ? "basico"
          : "gratis";
      const email = String(planCtx.usuario?.email || "").trim();
      if (["basico", "pro", "pro_max"].includes(planObjetivoTemprano) && !email) {
        await conversacionEstadoService.guardarEstado(msg.from, "cambio_plan", "esperando_email", { planObjetivo: planObjetivoTemprano });
        await replySinIA(
          `Para activar el **${String(planObjetivoTemprano).toUpperCase()}** primero necesito registrar tu email para generar el link de Mercado Pago.\n\n` +
          `👉 Por favor, escribí tu dirección de correo electrónico:`
        );
        return;
      }
      try {
        const outPlanTemprano = await resolverCambioPlanConPago({
          whatsapp: msg.from,
          planObjetivo: planObjetivoTemprano,
        });
        await replySinIA(outPlanTemprano);
      } catch (error) {
        console.error("[WhatsApp] Error cambio de plan (natural temprano):", error.message);
        await replySinIA(mensajeErrorCambioPlan(error));
      }
      return;
    }

    // Ruta dura para cambio de plan explícito (evita desvío por IA/consulta libre).
    if (
      comandoAlias === "QUIERO PLAN GRATIS" ||
      comandoAlias === "QUIERO PLAN BASICO" ||
      comandoAlias === "QUIERO PLAN PRO" ||
      comandoAlias === "QUIERO PLAN PRO MAX" ||
      comandoAlias === "QUIERO PLAN PROMAX"
    ) {
      logRoute(msg.from, "CMD_PLAN_HARD", { alias: comandoAlias });
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo =
        comandoAlias.endsWith("PRO MAX") || comandoAlias.endsWith("PROMAX")
          ? "pro_max"
          : comandoAlias.endsWith("PRO")
          ? "pro"
          : comandoAlias.endsWith("BASICO")
          ? "basico"
          : "gratis";
      const email = String(planCtx.usuario?.email || "").trim();
      if (["basico", "pro", "pro_max"].includes(planObjetivo) && !email) {
        await conversacionEstadoService.guardarEstado(msg.from, "cambio_plan", "esperando_email", { planObjetivo });
        await replySinIA(
          `Para activar el **${String(planObjetivo).toUpperCase()}** primero necesito registrar tu email para generar el link de Mercado Pago.\n\n` +
          `👉 Por favor, escribí tu dirección de correo electrónico:`
        );
        return;
      }
      try {
        const outPlan = await resolverCambioPlanConPago({
          whatsapp: msg.from,
          planObjetivo,
        });
        await replySinIA(outPlan);
      } catch (error) {
        console.error("[WhatsApp] Error cambio de plan:", error.message);
        await replySinIA(mensajeErrorCambioPlan(error));
      }
      return;
    }

    const intencionIA = await detectarIntencionIA(consulta);
    replyContexto.intencionTipo = intencionIA?.tipo || null;
    const comandoNaturalHeuristico = inferirComandoNatural(consulta);
    const comandoNatural =
      (intencionIA.tipo === "comando" && intencionIA.comando === "CREAR_ALERTA"
        ? "__ALERTA__"
        : intencionIA.tipo === "comando" && intencionIA.comando === "REGISTRAR_GASTO"
        ? "__GASTO__"
        : intencionIA.tipo === "comando" && intencionIA.comando === "REGISTRAR_VENTA"
        ? "__VENTA__"
        : intencionIA.tipo === "comando" && intencionIA.comando === "MI_RESUMEN"
        ? "MI RESUMEN"
        : intencionIA.tipo === "comando" && intencionIA.comando === "MIS_ALERTAS"
        ? "MIS ALERTAS"
        : intencionIA.tipo === "comando" && intencionIA.comando === "MI_MARGEN"
        ? "MI MARGEN"
        : intencionIA.tipo === "comando" && intencionIA.comando === "PLANES"
        ? "MI PLAN"
        : null) ||
      comandoNaturalHeuristico;

    if (comandoAlias === "MI PLAN" || comandoNatural === "MI PLAN") {
      logRoute(msg.from, "CMD_MI_PLAN");
      if (!planCtx.usuario?.id) {
        await msg.reply("Todavía no estás registrado. Escribime cualquier mensaje y te guío con el onboarding.");
        return;
      }
      try {
        const cGratis = await obtenerConfigPlan("gratis");
        const cBasico = await obtenerConfigPlan("basico");
        const cPro = await obtenerConfigPlan("pro");
        const cProMax = await obtenerConfigPlan("pro_max");

        const fmtLmt = (l) => l === -1 ? "Ilimitados" : `${l} semanales`;
        const fmtCons = (l) => l === -1 ? "Ilimitadas" : `${l} semanales`;

        await msg.reply(
          `🤖 *Planes Disponibles - AgroHabilis*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Tu plan actual es *${String(planCtx.planEfectivo || "gratis").toUpperCase()}*.\n\n` +
          `• *GRATIS* · $${cGratis.precio.toLocaleString("es-AR")}/mes\n` +
          `  - ${fmtCons(cGratis.limite_consultas_semanal)} consultas con el Agente\n` +
          `  - ${fmtLmt(cGratis.limite_audios_semanal)} notas de audio\n` +
          `  - ${fmtLmt(cGratis.limite_fotos_semanal)} fotos / análisis en vivo\n\n` +
          `• *BÁSICO* · $${cBasico.precio.toLocaleString("es-AR")}/mes\n` +
          `  - ${fmtCons(cBasico.limite_consultas_semanal)} consultas con el Agente\n` +
          `  - ${fmtLmt(cBasico.limite_audios_semanal)} notas de audio\n` +
          `  - ${fmtLmt(cBasico.limite_fotos_semanal)} fotos / análisis en vivo\n\n` +
          `• *PRO* · $${cPro.precio.toLocaleString("es-AR")}/mes\n` +
          `  - ${fmtCons(cPro.limite_consultas_semanal)} consultas con el Agente\n` +
          `  - ${fmtLmt(cPro.limite_audios_semanal)} notas de audio\n` +
          `  - ${fmtLmt(cPro.limite_fotos_semanal)} fotos / análisis en vivo\n\n` +
          `• *PRO MAX* · $${cProMax.precio.toLocaleString("es-AR")}/mes\n` +
          `  - Consultas, notas de audio y fotos *ILIMITADAS*\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `*Garantía de Valor:* Todos los planes acceden al 100% de las funcionalidades (márgenes, alertas, clima, finanzas y panel web).\n\n` +
          `Para cambiar tu plan, escribí:\n` +
          `👉 *QUIERO PLAN GRATIS*\n` +
          `👉 *QUIERO PLAN BASICO*\n` +
          `👉 *QUIERO PLAN PRO*\n` +
          `👉 *QUIERO PLAN PRO MAX*`
        );
      } catch (error) {
        console.error("[WhatsApp] Error mostrando planes:", error.message);
        await msg.reply(
          `Tu plan actual es *${String(planCtx.planEfectivo || "gratis").toUpperCase()}*.\n` +
          "Para cambiarlo escribí: QUIERO PLAN GRATIS | QUIERO PLAN BASICO | QUIERO PLAN PRO | QUIERO PLAN PRO MAX"
        );
      }
      return;
    }

    if (comandoAlias === "VER COMANDO" || comandoAlias === "VER COMANDOS") {
      logRoute(msg.from, "CMD_VER_COMANDOS");
      await msg.reply(obtenerTextoComandosUsuario());
      return;
    }

    const comandoPlanUnEspacio = comando.replace(/\s+/g, " ").trim();
    const pedidosBorradoCuenta = new Set([
      "BORRAR MIS DATOS",
      "ELIMINAR MI CUENTA",
      "ELIMINAR MIS DATOS",
      "DAR DE BAJA MI CUENTA",
      "BAJA MI CUENTA",
      "BORRAR MI CUENTA",
    ]);
    if (pedidosBorradoCuenta.has(comandoPlanUnEspacio) || comandoNatural === "BORRAR MIS DATOS") {
      logRoute(msg.from, "CMD_BORRAR_CUENTA_PASO1");
      if (!planCtx.usuario?.id) {
        await replySinIA("No hay una cuenta registrada con este número.");
        return;
      }
      await replySinIA(
        [
          "⚠️ *Borrado definitivo*",
          "",
          "Se van a eliminar tu usuario, perfil, cultivos, zona, alertas, gastos/ventas, resúmenes e historial de consultas en AgroHabilis.",
          "Esta acción *no se puede deshacer*.",
          "",
          "Si estás seguro, respondé *en una sola línea y exactamente*:",
          "*SI BORRO MIS DATOS*",
          "",
          "Si no querés borrar nada, ignorá este mensaje.",
        ].join("\n")
      );
      return;
    }

    if (comandoPlanUnEspacio === "SI BORRO MIS DATOS") {
      logRoute(msg.from, "CMD_BORRAR_CUENTA_CONFIRMADO");
      if (!planCtx.usuario?.id) {
        await replySinIA("No hay una cuenta registrada con este número.");
        return;
      }
      try {
        const eliminado = await eliminarUsuarioSoft(planCtx.usuario.id);
        if (!eliminado) {
          await replySinIA("No pude encontrar la cuenta para borrar. Si el problema sigue, contactá soporte.");
          return;
        }
        await replySinIA(
          "✅ *Listo.* Eliminé tu cuenta y los datos vinculados a este WhatsApp.\n\nGracias por haber usado AgroHabilis. Si más adelante querés volver, escribinos y empezamos un perfil nuevo."
        );
      } catch (e) {
        console.error("[WhatsApp] Error borrando cuenta:", e?.message || e);
        await replySinIA("No pude completar el borrado en este momento. Probá de nuevo en unos minutos o escribinos por soporte.");
      }
      return;
    }

    if (comandoNatural === "COMPLETAR PERFIL") {
      logRoute(msg.from, "CMDN_COMPLETAR_PERFIL");
      const inicio = await gestionarCompletarPerfil(msg.from, "COMPLETAR PERFIL");
      if (inicio.enFlujo) {
        await msg.reply(inicio.respuesta);
        return;
      }
    }

    if (
      comandoNatural === "QUIERO PLAN PRO" ||
      comandoNatural === "QUIERO PLAN BASICO" ||
      comandoNatural === "QUIERO PLAN GRATIS" ||
      comandoNatural === "QUIERO PLAN PRO MAX" ||
      comandoNatural === "QUIERO PLAN PROMAX"
    ) {
      logRoute(msg.from, "CMDN_CAMBIO_PLAN", { natural: comandoNatural });
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo =
        comandoNatural.endsWith("PRO MAX") || comandoNatural.endsWith("PROMAX")
          ? "pro_max"
          : comandoNatural.endsWith("PRO")
          ? "pro"
          : comandoNatural.endsWith("BASICO")
          ? "basico"
          : "gratis";
      try {
        const outPlan = await resolverCambioPlanConPago({
          whatsapp: msg.from,
          planObjetivo,
        });
        await msg.reply(outPlan);
      } catch (error) {
        console.error("[WhatsApp] Error cambio de plan (natural):", error.message);
        await msg.reply(mensajeErrorCambioPlan(error));
      }
      return;
    }

    if (comandoNatural === "__NOTICIAS__" && !comando.startsWith("MIS NOTICIAS ")) {
      logRoute(msg.from, "CMDN_NOTICIAS");
      const n = Number(consulta.match(/(\d{1,2})/)?.[1] || NaN);
      if (!Number.isFinite(n)) {
        await msg.reply('Decime la cantidad y lo aplico. Ejemplo: "MIS NOTICIAS 8".');
        return;
      }
      await query(
        `
          UPDATE usuarios
          SET noticias_cantidad_pref = $2
          WHERE id = $1
        `,
        [planCtx.usuario.id, Math.max(1, Math.min(15, Math.round(n)))]
      );
      await msg.reply(`✅ Listo. Voy a mostrar *${Math.max(1, Math.min(15, Math.round(n)))}* noticias destacadas.`);
      return;
    }

    if (comandoNatural === "__INSUMOS__") {
      logRoute(msg.from, "CMDN_INSUMOS");
      const respuesta = await procesarConsulta(msg.from, consulta, {
        intencionPrecalculada: intencionIA,
        numeroReal,
      });
      await msg.reply(formatearFechasTextoArg(respuesta));
      return;
    }

    if (comandoNatural === "__ALERTA__" && !comandoAlias.startsWith("ALERTA") && !comandoAlias.startsWith("AVISAME")) {
      logRoute(msg.from, "CMDN_ALERTA_NATURAL");
      const r = await configurarAlerta(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (comandoAlias.startsWith("MIS NOTICIAS ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const n = Number(consulta.slice("MIS NOTICIAS ".length).trim());
      if (!Number.isFinite(n) || n < 1 || n > 15) {
        await msg.reply('Formato: "MIS NOTICIAS 8" (rango permitido: 1 a 15).');
        return;
      }
      await query(
        `
          UPDATE usuarios
          SET noticias_cantidad_pref = $2
          WHERE id = $1
        `,
        [planCtx.usuario.id, Math.round(n)]
      );
      await msg.reply(`✅ Listo. A partir de ahora te voy a mostrar *${Math.round(n)}* noticias destacadas.`);
      return;
    }

    if (comandoAlias.startsWith("MI NOMBRE ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const nombre = consulta.slice("MI NOMBRE ".length).trim();
      if (!nombre) {
        await msg.reply('Formato: "MI NOMBRE Juan Pérez"');
        return;
      }
      await actualizarUsuario(planCtx.usuario.id, { nombre });
      await msg.reply(`✅ Listo, actualicé tu nombre a *${nombre}*.`);
      return;
    }

    if (comandoAlias.startsWith("MI EMAIL ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const email = parseEmail(consulta.replace(/^\s*MI\s+EMAIL\s+/i, "").trim());
      if (!email) {
        await msg.reply('Formato: "MI EMAIL nombre@dominio.com" (o mandá solo el correo).');
        return;
      }
      await actualizarUsuario(planCtx.usuario.id, { email });
      await msg.reply(`✅ Listo, guardé tu email: *${email}*.`);
      return;
    }

    const emailSoloLinea = esLineaSolamenteCorreo(consulta);
    if (emailSoloLinea) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      logRoute(msg.from, "CMD_EMAIL_SOLO_LINEA");
      await actualizarUsuario(planCtx.usuario.id, { email: emailSoloLinea });
      await msg.reply(`✅ Listo, guardé tu email: *${emailSoloLinea}*.`);
      return;
    }

    if (comandoAlias.startsWith("MI ZONA ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const zonaTxt = consulta.slice("MI ZONA ".length).trim();
      const zonas = parseZonas(zonaTxt);
      if (!zonas.length) {
        await msg.reply('Formato: "MI ZONA Buenos Aires, Tandil - Córdoba, Río Cuarto"');
        return;
      }
      const maxZonas = 999;
      const zonasLimitadas = zonas.slice(0, maxZonas);
      await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [planCtx.usuario.id]);
      for (let i = 0; i < zonasLimitadas.length; i += 1) {
        const z = zonasLimitadas[i];
        await query(
          `
            INSERT INTO usuario_zonas (usuario_id, provincia, partido, prioridad, activa)
            VALUES ($1, $2, $3, $4, true)
          `,
          [planCtx.usuario.id, z.provincia, z.partido, i + 1]
        );
      }
      await actualizarUsuario(planCtx.usuario.id, zonasLimitadas[0]);
      await msg.reply(
        `✅ Zonas actualizadas:\n` +
          zonasLimitadas.map((z) => `- ${z.provincia}, ${z.partido}`).join("\n")
      );
      return;
    }

    if (comandoAlias.startsWith("MIS CULTIVOS ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const cultivosTxt = consulta.slice("MIS CULTIVOS ".length).trim();
      const cultivos = parseCultivos(cultivosTxt);
      if (!cultivos.length) {
        await msg.reply('Formato: "MIS CULTIVOS soja, maiz, trigo"');
        return;
      }
      const perfilActual = await obtenerPerfil(msg.from);
      await guardarCultivosUsuario({
        usuarioId: planCtx.usuario.id,
        cultivos,
        hectareas: perfilActual?.cultivos?.[0]?.hectareas ?? null,
        costoPorHa: perfilActual?.cultivos?.[0]?.costo_por_ha ?? null,
      });
      const perfilTipoActual = await query(
        `
          SELECT tipo
          FROM perfil_productivo
          WHERE usuario_id = $1 AND activo = true
          ORDER BY id DESC
          LIMIT 1
        `,
        [planCtx.usuario.id]
      );
      const eraGanadero = String(perfilTipoActual.rows[0]?.tipo || "").toLowerCase() === "ganaderia";
      const tieneGanado = await query(
        "SELECT 1 FROM stock_ganadero WHERE usuario_id = $1 LIMIT 1",
        [planCtx.usuario.id]
      );
      await upsertPerfilProductivo(
        planCtx.usuario.id,
        tieneGanado.rows[0] || eraGanadero ? "mixto" : "agricultura"
      );
      await msg.reply(`✅ Cultivos actualizados: *${cultivos.join(", ")}*.`);
      return;
    }

    if (comandoAlias === "MI PERFIL MIXTO") {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      await upsertPerfilProductivo(planCtx.usuario.id, "mixto");
      await msg.reply("✅ Perfil productivo actualizado a *mixto* (cultivos + ganadería).");
      return;
    }

    if (comandoAlias.startsWith("MI GANADO ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const catsTxt = consulta.slice("MI GANADO ".length).trim();
      const { categorias, perfiles } = parseGanaderiaEstructurada(catsTxt);
      if (!categorias.length) {
        await msg.reply('Formato: "MI GANADO vacuno novillos, vacuno terneros, porcino madres, llama"');
        return;
      }
      await query("DELETE FROM stock_ganadero WHERE usuario_id = $1 AND fecha = CURRENT_DATE", [planCtx.usuario.id]);
      for (const categoria of categorias) {
        await query(
          `
            INSERT INTO stock_ganadero (usuario_id, categoria, cantidad, fecha)
            VALUES ($1, $2, $3, CURRENT_DATE)
          `,
          [planCtx.usuario.id, categoria, 1]
        );
      }
      await guardarPerfilGanaderoUsuario({ usuarioId: planCtx.usuario.id, perfiles });
      const cultivosActivos = await query(
        "SELECT 1 FROM usuario_cultivos WHERE usuario_id = $1 AND activo = true LIMIT 1",
        [planCtx.usuario.id]
      );
      await upsertPerfilProductivo(planCtx.usuario.id, cultivosActivos.rows[0] ? "mixto" : "ganaderia");
      const especies = [...new Set(perfiles.map((p) => p.especie))];
      await msg.reply(
        `✅ Ganado/categorías actualizadas: *${categorias.join(", ")}*.\nEspecies detectadas: *${especies.join(", ")}*.`
      );
      return;
    }

    if (comandoAlias === "VER MI PERFIL") {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const textoPerfil = await obtenerTextoPerfilUsuario(planCtx.usuario.id);
      await msg.reply(textoPerfil);
      return;
    }

    if (
      comandoAlias === "QUIERO PLAN GRATIS" ||
      comandoAlias === "QUIERO PLAN BASICO" ||
      comandoAlias === "QUIERO PLAN PRO" ||
      comandoAlias === "QUIERO PLAN PRO MAX" ||
      comandoAlias === "QUIERO PLAN PROMAX"
    ) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo =
        comandoAlias.endsWith("PRO MAX") || comandoAlias.endsWith("PROMAX")
          ? "pro_max"
          : comandoAlias.endsWith("PRO")
          ? "pro"
          : comandoAlias.endsWith("BASICO")
          ? "basico"
          : "gratis";
      try {
        const outPlan = await resolverCambioPlanConPago({
          whatsapp: msg.from,
          planObjetivo,
        });
        await msg.reply(outPlan);
      } catch (error) {
        console.error("[WhatsApp] Error cambio de plan (alias tardío):", error.message);
        await msg.reply(mensajeErrorCambioPlan(error));
      }
      return;
    }

    const respuestaAdmin = await responderComandoAdmin(msg.from, comandoAlias, {
      esAdmin: esAdminWhatsapp(msg.from),
      getEstadoWhatsapp: obtenerEstadoWhatsapp,
    });
    if (respuestaAdmin) {
      await msg.reply(respuestaAdmin);
      console.log(`[WhatsApp] Comando admin aplicado para ${msg.from}: ${comando}`);
      return;
    }

    if (comandoAlias.startsWith("RESET ONBOARDING")) {
      if (!esAdminWhatsapp(msg.from)) {
        await msg.reply("Este comando es solo para administradores.");
        return;
      }
      const numeroObjetivo = consulta.replace(/reset onboarding/i, "").trim();
      const r = await resetOnboardingNumero(numeroObjetivo);
      if (!r.ok) {
        await msg.reply(`❌ ${r.error}`);
        return;
      }
      await msg.reply(
        [
          `✅ Onboarding reseteado para ${r.numero}`,
          `- onboarding_estado: ${r.onboarding}`,
          `- whatsapp_bot_control: ${r.botControl}`,
          `- historial_consultas (sin usuario): ${r.consultasNull}`,
          `- usuarios eliminados: ${r.usuariosEliminados || 0}`,
          "",
          "El próximo mensaje de ese número iniciará onboarding desde cero.",
        ].join("\n")
      );
      return;
    }

    if (comandoNatural === "__ZONAS__" && planCtx.usuario?.id) {
      logRoute(msg.from, "CMDN_ZONAS");
      const zonasDirectas = parseZonas(
        consulta
          .replace(/^mi zona\s+/i, "")
          .replace(/^mis zonas\s+/i, "")
          .replace(/^zonas?\s+/i, "")
      );
      if (zonasDirectas.length) {
        const maxZonas = 999;
        const zonasLimitadas = zonasDirectas.slice(0, maxZonas);
        await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [planCtx.usuario.id]);
        for (let i = 0; i < zonasLimitadas.length; i += 1) {
          const z = zonasLimitadas[i];
          await query(
            `
              INSERT INTO usuario_zonas (usuario_id, provincia, partido, prioridad, activa)
              VALUES ($1, $2, $3, $4, true)
            `,
            [planCtx.usuario.id, z.provincia, z.partido, i + 1]
          );
        }
        await actualizarUsuario(planCtx.usuario.id, zonasLimitadas[0]);
        await msg.reply(
          `✅ Zonas actualizadas:\n` +
            zonasLimitadas.map((z) => `- ${z.provincia}, ${z.partido}`).join("\n")
        );
        return;
      }
      const inicio = await gestionarCompletarPerfil(msg.from, "COMPLETAR PERFIL");
      if (inicio.enFlujo) await msg.reply(inicio.respuesta);
      const pasoZonas = await gestionarCompletarPerfil(msg.from, "2");
      if (pasoZonas.enFlujo) await msg.reply(pasoZonas.respuesta);
      return;
    }

    const flujoCompletarPerfil = await gestionarCompletarPerfil(msg.from, consulta);
    if (flujoCompletarPerfil.enFlujo) {
      logRoute(msg.from, "FLOW_COMPLETAR_PERFIL");
      await msg.reply(flujoCompletarPerfil.respuesta);
      console.log(`[WhatsApp] Flujo COMPLETAR PERFIL para ${msg.from}`);
      return;
    }

    const respuestaComando = await manejarComandoBot(msg.from, consulta);
    if (respuestaComando) {
      logRoute(msg.from, "CMD_BOT_CONTROL");
      await msg.reply(respuestaComando);
      console.log(`[WhatsApp] Comando bot aplicado para ${msg.from}`);
      return;
    }

    if (comandoAlias === "MIS ALERTAS" || comandoNatural === "MIS ALERTAS") {
      logRoute(msg.from, "CMD_MIS_ALERTAS");
      const r = await listarAlertas(planCtx.usuario || msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias.startsWith("CANCELAR ALERTA")) {
      logRoute(msg.from, "CMD_CANCELAR_ALERTA");
      const id = consulta.match(/(\d+)/)?.[1];
      const r = await cancelarAlerta(planCtx.usuario || msg.from, id);
      await msg.reply(r);
      return;
    }

    if (comandoAlias.startsWith("ALERTA") || comandoAlias.startsWith("AVISAME")) {
      logRoute(msg.from, "CMD_ALERTA");
      const r = await configurarAlerta(planCtx.usuario || msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (
      comandoAlias.startsWith("GASTE") ||
      comandoAlias.startsWith("GASTÉ") ||
      comandoAlias.startsWith("COMPRE") ||
      comandoAlias.startsWith("COMPRÉ") ||
      comandoNatural === "__GASTO__"
    ) {
      logRoute(msg.from, "CMD_GASTO");
      const r = await registrarGasto(planCtx.usuario || msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (
      (comandoAlias.startsWith("VENDI") || comandoAlias.startsWith("VENDÍ") || comandoNatural === "__VENTA__") &&
      !esConsultaOperativaOnboarding(consulta) &&
      !esConsultaMercadoExcluyeRegistroVenta(consulta)
    ) {
      logRoute(msg.from, "CMD_VENTA");
      const r = await registrarVenta(planCtx.usuario || msg.from, consulta);
      await msg.reply(r);
      return;
    }

    const esRolRestringidoFinanzas = (u) => {
      if (!u?.es_delegado) return false;
      const rol = String(u.rol_operario || "").trim().toLowerCase();
      return ["operario", "tractorista"].includes(rol);
    };

    const MENSAJE_RESTRICCION_FINANZAS = (rol) => {
      return `⚠️ *Acceso Restringido: Finanzas*\n\n` +
             `Como integrante de equipo con el rol de *${String(rol || "operario").toUpperCase()}*, no tenés permisos para visualizar información financiera, gastos, ventas o resúmenes del establecimiento.\n\n` +
             `Si necesitás acceso, por favor solicitalo al administrador principal de la cuenta.`;
    };

    if (comandoAlias === "MIS GASTOS") {
      logRoute(msg.from, "CMD_MIS_GASTOS");
      if (esRolRestringidoFinanzas(planCtx.usuario)) {
        await msg.reply(MENSAJE_RESTRICCION_FINANZAS(planCtx.usuario.rol_operario));
        return;
      }
      const r = await obtenerTextoMisGastos(planCtx.usuario || msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MIS VENTAS") {
      logRoute(msg.from, "CMD_MIS_VENTAS");
      if (esRolRestringidoFinanzas(planCtx.usuario)) {
        await msg.reply(MENSAJE_RESTRICCION_FINANZAS(planCtx.usuario.rol_operario));
        return;
      }
      const r = await obtenerTextoMisVentas(planCtx.usuario || msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MI MARGEN" || comandoNatural === "MI MARGEN") {
      logRoute(msg.from, "CMD_MI_MARGEN");
      if (esRolRestringidoFinanzas(planCtx.usuario)) {
        await msg.reply(MENSAJE_RESTRICCION_FINANZAS(planCtx.usuario.rol_operario));
        return;
      }
      const r = await obtenerTextoMiMargen(planCtx.usuario || msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MI RESUMEN" || comandoNatural === "MI RESUMEN") {
      logRoute(msg.from, "CMD_MI_RESUMEN");
      if (esRolRestringidoFinanzas(planCtx.usuario)) {
        await msg.reply(MENSAJE_RESTRICCION_FINANZAS(planCtx.usuario.rol_operario));
        return;
      }
      const usuario = planCtx.usuario || await buscarPorWhatsapp(msg.from, numeroReal);
      if (!usuario) {
        await msg.reply(
          "Primero necesitamos completar tu perfil. Responde las preguntas de onboarding para habilitar tu resumen diario."
        );
        return;
      }
      const outMi = await resumenInteractivo.iniciarResumen(usuario, {
        enviar: (texto) => sendMessage(msg.from, texto),
      });
      if (outMi?.omitido) {
        await msg.reply(
          "Terminá primero lo que te preguntó el bot (registro o *COMPLETAR PERFIL*) y después escribí *MI RESUMEN*."
        );
        return;
      }
      try {
        await guardarConsulta({
          usuarioId: usuario.id,
          whatsapp: normalizarWhatsapp(msg.from),
          pregunta: String(msg.body || "").trim() || "MI RESUMEN",
          respuesta: "[Resumen interactivo: invitación enviada]",
          tokensUsados: null,
          iaSinContexto: null,
          iaProvider: "resumen_interactivo",
          iaProviderTrace: [{ stage: "flujo", value: "invitacion" }],
        });
      } catch (e) {
        console.warn("[WhatsApp] No se pudo guardar historial MI RESUMEN:", e.message);
      }
      console.log(`[WhatsApp] Resumen interactivo iniciado (MI RESUMEN) para ${msg.from}`);
      return;
    }

    const cmdFlete = parseComandoFlete(comando);
    if (cmdFlete) {
      logRoute(msg.from, "CMD_FLETE");
      const data = await calcularFlete(cmdFlete.origen, cmdFlete.destino, "granos", 28);
      if (data?.error) {
        await msg.reply(`No pude calcular ese flete: ${data.error}`);
        return;
      }
      await msg.reply(
        [
          `📦 Flete ${cmdFlete.origen} → ${cmdFlete.destino}`,
          `Distancia: ${data.distancia_km || "s/d"} km`,
          `Tarifa actual: USD ${Number(data.tarifa_usd_km_tn || 0).toFixed(5)}/km/tn`,
          `Costo flete: USD ${Number(data.costo_usd_tn || 0).toFixed(2)}/tn`,
          `Costo total (28 tn): USD ${Number(data.costo_total_usd || 0).toFixed(2)}`,
          `Peajes estimados: $${Number(data.peajes_ars || 0).toLocaleString("es-AR")}`,
          `(Ajustado por gasoil actual $${Number(data.gasoil_actual_ars || 0).toLocaleString("es-AR")}/lt)`,
        ].join("\n")
      );
      return;
    }

    // Modo estricto: si parece intención de comando, NO pasar a IA libre.
    const sugerencia = sugerirComandoPorTexto(consulta);
    if ((comandoNatural || pareceComandoExplicito(consulta, comandoAlias)) && !esConsultaOperativaOnboarding(consulta)) {
      logRoute(msg.from, "STRICT_SUGGESTION", {
        sugerencia: Boolean(sugerencia),
        comandoNatural: comandoNatural || null,
      });
      await msg.reply(
        sugerencia ||
          "Detecté que querés usar un comando. Escribí *VER COMANDOS* y te muestro la lista completa."
      );
      return;
    }

    const botActivo = await obtenerEstadoBot(msg.from);
    if (!botActivo) {
      const cmdCtrl = parseComandoBot(consulta);
      if (cmdCtrl) {
        const rBot = await manejarComandoBot(msg.from, consulta);
        if (rBot) await replySinIA(rBot);
        return;
      }
      console.log(
        `[WhatsApp] Consulta ignorada por bot pausado en chat ${msg.from}`
      );
      try {
        await replySinIA(
          "En este chat el bot está *pausado*. Para que vuelva a responder escribí: *ACTIVAR BOT*"
        );
      } catch (e) {
        console.warn("[WhatsApp] No se pudo avisar bot pausado:", e?.message || e);
      }
      return;
    }

    if (planCtx.usuario?.id) {
      const cupo = await validarCupoConsultasMensual({
        usuarioId: planCtx.usuario.id,
        planEfectivo: planCtx.planEfectivo,
      });
      if (!cupo.ok) {
        await conversacionEstadoService.guardarEstado(
          msg.from,
          "limite_alcanzado",
          "esperando_confirmacion_explicacion",
          { usuario_id: planCtx.usuario.id },
          2
        );
        await msg.reply(
          `Alcanzaste el límite de ${cupo.limite} consultas este mes en Plan Gratis. Pasate a Plan Básico para consultas ilimitadas.`
        );
        return;
      }
    }

    console.log(`[WhatsApp] Consulta recibida de ${msg.from}: ${consulta}`);
    logRoute(msg.from, "CONSULTA_OPERATIVA");
    const opcionesConsulta = { intencionPrecalculada: intencionIA, numeroReal };
    const asyncCola = !["0", "false", "off", "no", ""].includes(
      String(process.env.AGENT_CONSULTA_ASYNC ?? "").trim().toLowerCase()
    );
    if (asyncCola) {
      await encolarConsultaWhatsapp({
        jid: msg.from,
        consulta,
        opciones: opcionesConsulta,
      });
      await msg.reply(
        "Estoy procesando tu consulta; te respondo en unos segundos. Si tarda, escribí de nuevo *HOLA* para ver estado."
      );
      return;
    }
    const respuesta = await procesarConsulta(msg.from, consulta, opcionesConsulta);
    await msg.reply(
      typeof respuesta === "string" && respuesta.trim()
        ? formatearFechasTextoArg(respuesta)
        : "No pude armar una respuesta útil con esa consulta. Probá reformularla en una línea (ej: 'precio maíz rosario hoy')."
    );
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
};

client.on("message", (msg) => {
  void procesarMensajeEntranteWhatsapp(msg);
});

/** Tras conectar, procesa mensajes entrantes que quedaron sin leer (mientras el bot estaba offline). */
const drenarChatsNoLeidosWhatsapp = async () => {
  const off = ["0", "false", "off", "no"].includes(
    String(process.env.WHATSAPP_DRENAR_NO_LEIDOS ?? "1").trim().toLowerCase()
  );
  if (off || !sesionWhatsappOperativa()) return;
  try {
    const chats = await client.getChats();
    let procesados = 0;
    for (const chat of chats) {
      if (chat.isGroup || !chat.unreadCount || chat.unreadCount <= 0) continue;
      const jid = String(chat.id?._serialized || "");
      if (!jid || jid.includes("@g.us") || jid.includes("@broadcast")) continue;
      const limite = Math.min(Math.max(chat.unreadCount + 5, 8), 100);
      let msgs;
      try {
        msgs = await chat.fetchMessages({ limit: limite });
      } catch (e) {
        console.warn(
          "[WhatsApp] Drenaje: fetchMessages fallo",
          jid,
          e?.message || e
        );
        continue;
      }
      const entrantes = msgs
        .filter(
          (m) =>
            !m.fromMe &&
            !String(m.from || "").includes("@g.us") &&
            !String(m.from || "").includes("@broadcast")
        )
        .filter((m) => String(m.body || "").trim());
      entrantes.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      const n = Math.min(chat.unreadCount, entrantes.length);
      const slice = entrantes.slice(-n);
      for (const m of slice) {
        procesados += 1;
        await procesarMensajeEntranteWhatsapp(m);
      }
      try {
        await chat.sendSeen();
      } catch (_e) {
        /* ok */
      }
    }
    if (procesados > 0) {
      console.log(
        `[WhatsApp] Drenaje no leidos: ${procesados} mensaje(s) entrante(s) procesado(s).`
      );
    }
  } catch (err) {
    console.error("[WhatsApp] Drenaje no leidos:", err?.message || err);
  }
};

client.on("ready", () => {
  ready = true;
  estadoConexion = "listo";
  ultimoMotivoWhatsapp = null;
  reconnectAttempts = 0;
  reconnectInProgress = false;
  void borrarQrWhatsappPng();
  console.log("WhatsApp conectado");
  const delayMs = Math.max(
    500,
    Number.parseInt(String(process.env.WHATSAPP_DRENAR_DELAY_MS || "2500"), 10) ||
      2500
  );
  setTimeout(() => {
    void drenarChatsNoLeidosWhatsapp();
  }, delayMs);
  iniciarDrenadorColaAgentConsultasSiCorresponde();
  iniciarProcesadorColaReintentosVision({ sendMessage });
});

client.on("authenticated", () => {
  void borrarQrWhatsappPng();
  console.log("Sesion de WhatsApp autenticada");
});

const sendMessage = async (numero, mensaje) => {
  if (!numero) {
    throw new Error("Numero requerido para sendMessage");
  }
  const destinoRaw = String(numero).trim();
  if (!destinoRaw) {
    throw new Error("Numero invalido");
  }
  if (!mensaje || !String(mensaje).trim()) {
    throw new Error("Mensaje vacio");
  }
  const waitReadyMs = Math.min(
    Math.max(Number(process.env.WHATSAPP_SEND_READY_TIMEOUT_MS) || 120_000, 15_000),
    600_000
  );
  if (!sesionWhatsappOperativa()) {
    try {
      await esperarClienteListo(waitReadyMs);
    } catch (error) {
      console.error("[WhatsApp] Timeout/espera fallida antes de enviar:", error.message);
      throw new Error(
        `Cliente de WhatsApp no está listo para enviar (${error.message}). Revisá QR/sesión en el VPS.`
      );
    }
  }

  // JID directo (@c.us / @lid): no exigir dígitos antes (evita fallar con formatos raros).
  if (destinoRaw.includes("@")) {
    return client.sendMessage(destinoRaw, formatearRespuestaAmigable(String(mensaje)));
  }

  const numeroLimpio = destinoRaw.replace(/\D/g, "");
  if (!numeroLimpio) {
    throw new Error("Numero invalido");
  }

  // Algunos numeros resuelven a @lid en lugar de @c.us.
  const numberId = await client.getNumberId(numeroLimpio);
  if (!numberId?._serialized) {
    throw new Error("Numero no registrado en WhatsApp");
  }
  return client.sendMessage(numberId._serialized, formatearRespuestaAmigable(String(mensaje)));
};

/** Reenvío manual (admin): mismo texto/link que el flujo de cambio de plan por WhatsApp. */
const enviarCambioPlanWhatsapp = async ({ whatsapp, planObjetivo }) => {
  const w = String(whatsapp || "").trim();
  if (!w) {
    return { ok: false, error: "whatsapp requerido", detalle: "" };
  }
  const plan = String(planObjetivo || "").trim().toLowerCase();
  if (!["basico", "pro", "pro_max", "gratis"].includes(plan)) {
    return {
      ok: false,
      error: "planObjetivo inválido. Usar: basico | pro | pro_max | gratis",
      detalle: "",
    };
  }
  let texto;
  try {
    texto = await resolverCambioPlanConPago({ whatsapp: w, planObjetivo: plan });
  } catch (err) {
    return {
      ok: false,
      error: mensajeErrorCambioPlan(err),
      detalle: String(err?.message || err),
    };
  }
  try {
    const envio = await sendMessage(w, texto);
    return {
      ok: true,
      texto,
      messageId: envio?.id?._serialized || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Se generó el mensaje pero falló el envío por WhatsApp: ${String(err?.message || err)}`,
      detalle: String(err?.message || err),
      texto,
    };
  }
};

/** Ruta absoluta del PNG del QR de vinculación (si WHATSAPP_QR_PNG lo genera). */
const getRutaQrWhatsappPng = () => resolveWhatsappQrPngPath();

let colaAgentDrainerIniciado = false;

const iniciarDrenadorColaAgentConsultasSiCorresponde = () => {
  if (colaAgentDrainerIniciado) return;
  if (["0", "false", "off", "no", ""].includes(String(process.env.AGENT_CONSULTA_ASYNC ?? "").trim().toLowerCase())) {
    return;
  }
  colaAgentDrainerIniciado = true;
  const ms = Math.max(400, Number.parseInt(String(process.env.AGENT_COLA_POLL_MS || "900"), 10) || 900);
  setInterval(() => {
    void drenarUnaConsultaWhatsapp({
      procesarConsulta,
      sendMessage,
      formatearFechasTextoArg,
    });
  }, ms);
  console.log(`[WhatsApp] Cola agent (consulta async): drenador cada ${ms}ms`);
};

// procesarColaReintentosVision y su iniciador fueron modularizados a src/services/vision/telemetria_worker.js

module.exports = {
  client,
  estaListo,
  initializeWhatsApp,
  obtenerEstadoWhatsapp,
  obtenerEstadoWhatsappDetalle,
  esperarClienteListo,
  sendMessage,
  enviarCambioPlanWhatsapp,
  getRutaQrWhatsappPng,
  resolverNumeroRealMensaje,
};
