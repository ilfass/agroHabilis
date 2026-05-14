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
  puedeUsarAlertas,
  puedeUsarFinanzas,
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
  esQuejaCorreccionRespuestaBot,
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
  if (esQuejaCorreccionRespuestaBot(String(mensajeUsuario || ""))) {
    return draft;
  }
  if (
    draft.includes("━━━━━━━━") ||
    /PLANTILLA\s+(GRATIS|BASICO|BÁSICO|PRO)\b/i.test(draft) ||
    /📦\s*\*PLANTILLA\b/i.test(draft)
  ) {
    // Evitar reescrituras agresivas de layouts completos (todos los planes).
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
      "Sos AgroHabilis. Reescribí el borrador en lenguaje natural de WhatsApp.",
      "Reglas estrictas:",
      "- No inventes datos, fechas, precios ni fuentes.",
      "- Conservá todos los datos concretos del borrador.",
      "- Respuesta breve (4-5 líneas) salvo que el contenido requiera más.",
      "- Evitá etiquetas técnicas como NO_DATA/CONTEXT.",
      "- No repitas ni cites el texto de mensajeUsuario al inicio ni como encabezado; respondé directo al punto.",
      "- Mantené o mejorá formato WhatsApp: *negrita*, _cursiva_, emojis en títulos de bloque y separadores ━ si aportan claridad.",
      "- No agregues el nombre del usuario al inicio si el borrador no lo trae ya; no inventes tratamientos personales.",
      "- Para decir 'hoy' o la fecha en Argentina usá solo fecha_hoy_ar del JSON (no la fecha del servidor).",
    ].join("\n");
    const user = JSON.stringify(
      {
        fecha_hoy_ar: fechaISOArgentina(),
        usuario: {
          nombre: usuario?.nombre || null,
          zona: `${usuario?.partido || ""}, ${usuario?.provincia || ""}`.trim(),
          plan: usuario?.plan || null,
        },
        mensajeUsuario: String(mensajeUsuario || "").slice(0, 350),
        historial: historial.rows || [],
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
});

client.on("disconnected", async (reason) => {
  ready = false;
  ultimoWaState = null;
  estadoConexion = "desconectado";
  ultimoMotivoWhatsapp = String(reason || "").slice(0, 300) || "desconocido";
  console.warn("WhatsApp desconectado:", reason);

  if (reconnectInProgress) {
    console.log("[WhatsApp] Reconexion ya en progreso, se omite intento duplicado.");
    return;
  }

  const intentarReconectar = async (attempt = 1) => {
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[WhatsApp] Error crítico: no se pudo reconectar tras ${MAX_RECONNECT_ATTEMPTS} intentos.`
      );
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

    const consulta = String(msg.body || "").trim();
    if (!consulta) return;
    const numeroReal = await resolverNumeroRealMensaje(msg);
    await registrarIdentidadWhatsapp({
      jid: msg.from,
      whatsappReal: numeroReal,
    });

    const comando = normalizarParaComandoRuteo(consulta);
    const comandoAlias = resolverComandoAlias(comando);
    const planCtx = await obtenerContextoPlanPorWhatsapp(msg.from);

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
        mensajeUsuario: String(msg.body || ""),
        borrador: String(texto || ""),
        intencionTipo: replyContexto.intencionTipo,
      });
      const final = formatearRespuestaAmigable(String(humanizada || texto || ""));
      emitCapturaSalida(final, replyContexto.intencionTipo || "reply");
      return msgReplyRaw(final, ...args);
    };

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

    // Onboarding debe tener prioridad absoluta para evitar caer en IA libre
    // cuando el usuario todavía está completando alta.
    if (!esAdminWhatsapp(msg.from)) {
      const onboarding = await gestionarOnboarding(msg.from, consulta);
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
      pedidoPlanHeuristico === "QUIERO PLAN GRATIS"
    ) {
      logRoute(msg.from, "CMD_PLAN_NATURAL_TEMPRANO", { natural: pedidoPlanHeuristico });
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivoTemprano = pedidoPlanHeuristico.endsWith("PRO")
        ? "pro"
        : pedidoPlanHeuristico.endsWith("BASICO")
        ? "basico"
        : "gratis";
      try {
        const outPlanTemprano = await resolverCambioPlanConPago({
          whatsapp: msg.from,
          planObjetivo: planObjetivoTemprano,
        });
        await msg.reply(outPlanTemprano);
      } catch (error) {
        console.error("[WhatsApp] Error cambio de plan (natural temprano):", error.message);
        await msg.reply(mensajeErrorCambioPlan(error));
      }
      return;
    }

    // Ruta dura para cambio de plan explícito (evita desvío por IA/consulta libre).
    if (
      comandoAlias === "QUIERO PLAN GRATIS" ||
      comandoAlias === "QUIERO PLAN BASICO" ||
      comandoAlias === "QUIERO PLAN PRO"
    ) {
      logRoute(msg.from, "CMD_PLAN_HARD", { alias: comandoAlias });
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo = comandoAlias.endsWith("PRO")
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
        console.error("[WhatsApp] Error cambio de plan:", error.message);
        await msg.reply(mensajeErrorCambioPlan(error));
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
      await msg.reply(
        `Tu plan actual es *${String(planCtx.planEfectivo || "gratis").toUpperCase()}*.\n` +
          "Precios: GRATIS $0/mes | BASICO $9.000/mes | PRO $18.000/mes\n" +
          "Para cambiarlo escribí: QUIERO PLAN GRATIS | QUIERO PLAN BASICO | QUIERO PLAN PRO"
      );
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

    if (comandoNatural === "QUIERO PLAN PRO" || comandoNatural === "QUIERO PLAN BASICO" || comandoNatural === "QUIERO PLAN GRATIS") {
      logRoute(msg.from, "CMDN_CAMBIO_PLAN", { natural: comandoNatural });
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo = comandoNatural.endsWith("PRO")
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
      if (planCtx.planEfectivo !== "pro") {
        await msg.reply("La configuración personalizada de noticias está disponible en Plan Pro. Escribí: QUIERO PLAN PRO");
        return;
      }
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
      });
      await msg.reply(formatearFechasTextoArg(respuesta));
      return;
    }

    if (comandoNatural === "__ALERTA__" && !comandoAlias.startsWith("ALERTA") && !comandoAlias.startsWith("AVISAME")) {
      logRoute(msg.from, "CMDN_ALERTA_NATURAL");
      if (!puedeUsarAlertas(planCtx.planEfectivo)) {
        await msg.reply(
          "Las alertas de precio están disponibles en Plan Básico o Pro. Escribí 'QUIERO PLAN BASICO' para activarlas."
        );
        return;
      }
      const r = await configurarAlerta(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (comandoAlias.startsWith("MIS NOTICIAS ")) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      if (planCtx.planEfectivo !== "pro") {
        await msg.reply("La configuración personalizada de cantidad de noticias está disponible en Plan Pro.");
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
      const maxZonas = planCtx.planEfectivo === "pro" ? 6 : planCtx.planEfectivo === "basico" ? 3 : 1;
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
        `✅ Zonas actualizadas (${zonasLimitadas.length}/${maxZonas} por tu plan).\n` +
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
      comandoAlias === "QUIERO PLAN PRO"
    ) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo = comandoAlias.endsWith("PRO")
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
        const maxZonas = planCtx.planEfectivo === "pro" ? 6 : planCtx.planEfectivo === "basico" ? 3 : 1;
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
          `✅ Zonas actualizadas (${zonasLimitadas.length}/${maxZonas} por tu plan).\n` +
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
      if (!puedeUsarAlertas(planCtx.planEfectivo)) {
        await msg.reply(
          "Las alertas de precio están disponibles en Plan Básico o Pro. Escribí 'QUIERO PLAN BASICO' para activarlas."
        );
        return;
      }
      const r = await listarAlertas(msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias.startsWith("CANCELAR ALERTA")) {
      logRoute(msg.from, "CMD_CANCELAR_ALERTA");
      if (!puedeUsarAlertas(planCtx.planEfectivo)) {
        await msg.reply("Tu plan actual no incluye alertas de precio.");
        return;
      }
      const id = consulta.match(/(\d+)/)?.[1];
      const r = await cancelarAlerta(msg.from, id);
      await msg.reply(r);
      return;
    }

    if (comandoAlias.startsWith("ALERTA") || comandoAlias.startsWith("AVISAME")) {
      logRoute(msg.from, "CMD_ALERTA");
      if (!puedeUsarAlertas(planCtx.planEfectivo)) {
        await msg.reply(
          "Las alertas de precio están disponibles en Plan Básico o Pro. Escribí 'QUIERO PLAN BASICO' y te ayudamos a activarlo."
        );
        return;
      }
      const r = await configurarAlerta(msg.from, consulta);
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
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply(
          "El registro de gastos está disponible en Plan Pro. Escribí 'QUIERO PLAN PRO' para activarlo."
        );
        return;
      }
      const r = await registrarGasto(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (
      (comandoAlias.startsWith("VENDI") || comandoAlias.startsWith("VENDÍ") || comandoNatural === "__VENTA__") &&
      !esConsultaOperativaOnboarding(consulta) &&
      !esConsultaMercadoExcluyeRegistroVenta(consulta)
    ) {
      logRoute(msg.from, "CMD_VENTA");
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply(
          "El registro de ventas está disponible en Plan Pro. Escribí 'QUIERO PLAN PRO' para activarlo."
        );
        return;
      }
      const r = await registrarVenta(msg.from, consulta);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MIS GASTOS") {
      logRoute(msg.from, "CMD_MIS_GASTOS");
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply("Esta funcionalidad está disponible en Plan Pro.");
        return;
      }
      const r = await obtenerTextoMisGastos(msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MIS VENTAS") {
      logRoute(msg.from, "CMD_MIS_VENTAS");
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply("Esta funcionalidad está disponible en Plan Pro.");
        return;
      }
      const r = await obtenerTextoMisVentas(msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MI MARGEN" || comandoNatural === "MI MARGEN") {
      logRoute(msg.from, "CMD_MI_MARGEN");
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply("Esta funcionalidad está disponible en Plan Pro.");
        return;
      }
      const r = await obtenerTextoMiMargen(msg.from);
      await msg.reply(r);
      return;
    }

    if (comandoAlias === "MI RESUMEN" || comandoNatural === "MI RESUMEN") {
      logRoute(msg.from, "CMD_MI_RESUMEN");
      const usuario = await buscarPorWhatsapp(msg.from);
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
        await msg.reply(
          `Alcanzaste el límite de ${cupo.limite} consultas este mes en Plan Gratis. Pasate a Plan Básico para consultas ilimitadas.`
        );
        return;
      }
    }

    console.log(`[WhatsApp] Consulta recibida de ${msg.from}: ${consulta}`);
    logRoute(msg.from, "CONSULTA_OPERATIVA");
    const opcionesConsulta = { intencionPrecalculada: intencionIA };
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
  if (!["basico", "pro", "gratis"].includes(plan)) {
    return {
      ok: false,
      error: "planObjetivo inválido. Usar: basico | pro | gratis",
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
};
