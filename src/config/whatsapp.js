const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { query } = require("./database");
const {
  manejarComandoBot,
  obtenerEstadoBot,
  procesarConsulta,
} = require("../services/consultas");
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
} = require("../models/usuario");
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
const { resumenFuentesWhatsapp } = require("../services/fuentes_monitor");
const COMANDOS = require("./comandos");

const normalizarTexto = (texto = "") =>
  String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const parseProvinciaPartido = (texto = "") => {
  const parts = String(texto)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { provincia: parts[0], partido: parts.slice(1).join(", ") };
};

const parseZonas = (texto = "") =>
  String(texto)
    .split(/\s*-\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((bloque) => parseProvinciaPartido(bloque))
    .filter(Boolean);

const inferirComandoNatural = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return null;
  if (/pasar.*plan pro|cambiar.*plan pro|plan pro/.test(t)) return "QUIERO PLAN PRO";
  if (/pasar.*plan basico|cambiar.*plan basico|plan basico|plan básico/.test(t)) return "QUIERO PLAN BASICO";
  if (/pasar.*plan gratis|cambiar.*plan gratis|plan gratis/.test(t)) return "QUIERO PLAN GRATIS";
  if (/editar perfil|modificar perfil|actualizar perfil|completar perfil/.test(t)) return "COMPLETAR PERFIL";
  if (/(agregar|actualizar|modificar).*(zona|zonas|lote|lotes)|quiero agregar zonas/.test(t)) return "__ZONAS__";
  if (/(agregar|sumar|mas|más).*(noticia|noticias)|configurar noticias/.test(t)) return "__NOTICIAS__";
  if (/(vendi|vendi|venta|vender)/.test(t) && /\d/.test(t)) return "__VENTA__";
  if (/(gaste|gaste|compre|compr[eé]|gasto|compra)/.test(t) && /\d/.test(t)) return "__GASTO__";
  return null;
};

const sugerirComandoPorTexto = (texto = "") => {
  const t = normalizarTexto(texto);
  if (!t) return null;
  const reglas = [
    { re: /(enviar|mandar|quiero).*(resumen)|mi resumen/, cmd: "MI RESUMEN" },
    { re: /(plan pro|pasar a pro|subir plan)/, cmd: "QUIERO PLAN PRO" },
    { re: /(plan basico|plan básico|pasar a basico)/, cmd: "QUIERO PLAN BASICO" },
    { re: /(plan gratis|bajar plan)/, cmd: "QUIERO PLAN GRATIS" },
    { re: /(editar perfil|modificar perfil|actualizar perfil|completar perfil)/, cmd: "COMPLETAR PERFIL" },
    { re: /(zona|zonas|lote|lotes)/, cmd: "MI ZONA <provincia>, <partido>" },
    { re: /(cultivo|cultivos)/, cmd: "MIS CULTIVOS <c1, c2, ...>" },
    { re: /(ganado|hacienda|novillo|ternero|vaca)/, cmd: "MI GANADO <cat1, cat2, ...>" },
    { re: /(alerta|avisame|avísame)/, cmd: "ALERTA ... / AVISAME ..." },
    { re: /(gasto|gastos|compre|compré|gaste|gasté)/, cmd: "MIS GASTOS" },
    { re: /(venta|ventas|vendi|vendí)/, cmd: "MIS VENTAS" },
    { re: /(margen|rentabilidad)/, cmd: "MI MARGEN" },
    { re: /(comando|comandos|ayuda|menu)/, cmd: "VER COMANDOS" },
    { re: /(nombre)/, cmd: "MI NOMBRE <nombre>" },
  ];
  const hit = reglas.find((r) => r.re.test(t));
  if (!hit) return null;
  return `Detecté una intención de comando.\n👉 Probá con: *${hit.cmd}*\nSi querés ver todos los comandos, escribí: *VER COMANDOS*`;
};

const parseCultivos = (texto = "") =>
  String(texto)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase());

const parseCategoriasGanaderas = (texto = "") =>
  String(texto)
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const ESPECIES_GANADERAS = [
  { especie: "vacuno", keys: ["vacuno", "bovino", "novillo", "ternero", "vaca", "vaquillona", "toro"] },
  { especie: "porcino", keys: ["porcino", "cerdo", "lechon", "lechón", "chancho"] },
  { especie: "ovino", keys: ["ovino", "oveja", "cordero", "carnero"] },
  { especie: "caprino", keys: ["caprino", "cabra", "chivo"] },
  { especie: "camelido", keys: ["llama", "alpaca", "guanaco", "vicuña", "vicuna", "camelido"] },
  { especie: "equino", keys: ["equino", "caballo", "yegua"] },
  { especie: "avicola", keys: ["avicola", "avícola", "pollo", "gallina", "ponedora"] },
];

const inferirEspecieGanadera = (categoria = "") => {
  const t = normalizarTexto(categoria);
  const hit = ESPECIES_GANADERAS.find((e) => e.keys.some((k) => t.includes(normalizarTexto(k))));
  return hit?.especie || "otra";
};

const parseGanaderiaEstructurada = (texto = "") => {
  const categorias = parseCategoriasGanaderas(texto);
  const perfiles = categorias.map((c) => ({
    especie: inferirEspecieGanadera(c),
    categoria: c.slice(0, 60),
  }));
  return { categorias, perfiles };
};

const guardarPerfilGanaderoUsuario = async ({ usuarioId, perfiles = [] }) => {
  await query("DELETE FROM usuario_ganaderia_perfil WHERE usuario_id = $1", [usuarioId]);
  for (const p of perfiles) {
    await query(
      `
        INSERT INTO usuario_ganaderia_perfil (usuario_id, especie, categoria, cantidad_estimada, activo)
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (usuario_id, especie, categoria)
        DO UPDATE SET cantidad_estimada = EXCLUDED.cantidad_estimada, activo = true
      `,
      [usuarioId, p.especie, p.categoria, 1]
    );
  }
};

const upsertPerfilProductivo = async (usuarioId, tipo) => {
  const current = await query(
    `
      SELECT id
      FROM perfil_productivo
      WHERE usuario_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  if (current.rows[0]) {
    await query(
      `
        UPDATE perfil_productivo
        SET tipo = $2, activo = true
        WHERE id = $1
      `,
      [current.rows[0].id, tipo]
    );
    return;
  }
  await query(
    `
      INSERT INTO perfil_productivo (usuario_id, tipo, activo)
      VALUES ($1, $2, true)
    `,
    [usuarioId, tipo]
  );
};

const obtenerTextoPerfilUsuario = async (usuarioId) => {
  const usuarioResult = await query(
    `
      SELECT nombre, provincia, partido, plan, tipo_comercializacion
      FROM usuarios
      WHERE id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const usuario = usuarioResult.rows[0];
  if (!usuario) return "No encontré tu perfil.";
  const cultivosResult = await query(
    `
      SELECT cultivo
      FROM usuario_cultivos
      WHERE usuario_id = $1 AND activo = true
      ORDER BY cultivo
    `,
    [usuarioId]
  );
  const perfilResult = await query(
    `
      SELECT tipo
      FROM perfil_productivo
      WHERE usuario_id = $1 AND activo = true
      ORDER BY id DESC
      LIMIT 1
    `,
    [usuarioId]
  );
  const stock = await query(
    `
      SELECT categoria, cantidad
      FROM stock_ganadero
      WHERE usuario_id = $1
        AND fecha = (SELECT MAX(fecha) FROM stock_ganadero WHERE usuario_id = $1)
      ORDER BY categoria
    `,
    [usuarioId]
  );
  const cultivos = cultivosResult.rows.map((r) => r.cultivo);
  const stockTxt = stock.rows.length
    ? stock.rows.map((s) => `${s.categoria}:${s.cantidad}`).join(", ")
    : "sin datos";
  return [
    "👤 *Tu perfil actual*",
    `Nombre: ${usuario.nombre || "-"}`,
    `Zona: ${usuario.provincia || "-"}, ${usuario.partido || "-"}`,
    `Plan: ${String(usuario.plan || "gratis").toUpperCase()}`,
    `Comercialización: ${usuario.tipo_comercializacion || "disponible"}`,
    `Perfil productivo: ${perfilResult.rows[0]?.tipo || "agricultura"}`,
    `Cultivos: ${cultivos.length ? cultivos.join(", ") : "sin cultivos"}`,
    `Ganado (último stock): ${stockTxt}`,
  ].join("\n");
};

const sessionPath = process.env.WHATSAPP_SESSION_PATH || "./.wwebjs_auth";
const whatsappClientId = process.env.WHATSAPP_CLIENT_ID?.trim() || "agrohabilis";

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
  qrMaxRetries: 10,
  authTimeoutMs: 120000,
});

let initialized = false;
let ready = false;
let estadoConexion = "inicializando";
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let reconnectInProgress = false;

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

const obtenerTextoComandosUsuario = () => {
  const lista = Array.isArray(COMANDOS?.whatsappUsuario) ? COMANDOS.whatsappUsuario : [];
  if (!lista.length) return "No hay comandos configurados por ahora.";
  return [
    "📚 *Comandos disponibles*",
    ...lista.map((c) => `- *${c.comando}*: ${c.descripcion}`),
  ].join("\n");
};

const responderComandoAdmin = async (from, comando) => {
  const cmd = String(comando || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();

  if (!["ESTADO", "ESTADO SISTEMA", "ESTADO IA", "ESTADO DB", "USUARIOS", "FUENTES"].includes(cmd)) {
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

  if (cmd === "FUENTES") {
    return resumenFuentesWhatsapp();
  }

  return obtenerEstadoSistemaTexto();
};

const resetOnboardingNumero = async (numeroInput = "") => {
  const numero = normalizarNumero(numeroInput);
  if (!numero) {
    return { ok: false, error: "Número inválido. Usá: RESET ONBOARDING 549XXXXXXXXXX" };
  }

  const borradoOnboarding = await query(
    `
      DELETE FROM onboarding_estado
      WHERE
        regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
        OR whatsapp = ($1 || '@lid')
        OR whatsapp = ($1 || '@c.us')
    `,
    [numero]
  );

  const borradoBotControl = await query(
    `
      DELETE FROM whatsapp_bot_control
      WHERE regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
    `,
    [numero]
  );

  const limpiadoConsultasNull = await query(
    `
      DELETE FROM historial_consultas
      WHERE usuario_id IS NULL
        AND regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
    `,
    [numero]
  );

  return {
    ok: true,
    numero,
    onboarding: borradoOnboarding.rowCount || 0,
    botControl: borradoBotControl.rowCount || 0,
    consultasNull: limpiadoConsultasNull.rowCount || 0,
  };
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
  reconnectInProgress = false;
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

client.on("message", async (msg) => {
  try {
    if (msg.from?.includes("@g.us")) return;
    if (msg.from?.includes("@broadcast")) return;
    if (msg.fromMe) return;

    const consulta = String(msg.body || "").trim();
    if (!consulta) return;
    const numeroReal = await resolverNumeroRealMensaje(msg);
    await registrarIdentidadWhatsapp({
      jid: msg.from,
      whatsappReal: numeroReal,
    });

    const comando = consulta
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
    const planCtx = await obtenerContextoPlanPorWhatsapp(msg.from);
    const comandoNatural = inferirComandoNatural(consulta);

    if (comando === "MI PLAN") {
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

    if (comando === "VER COMANDO" || comando === "VER COMANDOS") {
      await msg.reply(obtenerTextoComandosUsuario());
      return;
    }

    if (comandoNatural === "COMPLETAR PERFIL") {
      const inicio = await gestionarCompletarPerfil(msg.from, "COMPLETAR PERFIL");
      if (inicio.enFlujo) {
        await msg.reply(inicio.respuesta);
        return;
      }
    }

    if (comandoNatural === "QUIERO PLAN PRO" || comandoNatural === "QUIERO PLAN BASICO" || comandoNatural === "QUIERO PLAN GRATIS") {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo = comandoNatural.endsWith("PRO")
        ? "pro"
        : comandoNatural.endsWith("BASICO")
        ? "basico"
        : "gratis";
      const actualizado = await actualizarPlanPorWhatsapp({
        whatsapp: msg.from,
        plan: planObjetivo,
      });
      if (!actualizado) {
        await msg.reply("No pude actualizar tu plan en este momento. Probá nuevamente en unos minutos.");
        return;
      }
      await msg.reply(`✅ Entendido. Actualicé tu plan a *${String(actualizado.plan || planObjetivo).toUpperCase()}*.`);
      return;
    }

    if (comandoNatural === "__NOTICIAS__" && !comando.startsWith("MIS NOTICIAS ")) {
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

    if (comando.startsWith("MIS NOTICIAS ")) {
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

    if (comando.startsWith("MI NOMBRE ")) {
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

    if (comando.startsWith("MI ZONA ")) {
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

    if (comando.startsWith("MIS CULTIVOS ")) {
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

    if (comando === "MI PERFIL MIXTO") {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      await upsertPerfilProductivo(planCtx.usuario.id, "mixto");
      await msg.reply("✅ Perfil productivo actualizado a *mixto* (cultivos + ganadería).");
      return;
    }

    if (comando.startsWith("MI GANADO ")) {
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

    if (comando === "VER MI PERFIL") {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const textoPerfil = await obtenerTextoPerfilUsuario(planCtx.usuario.id);
      await msg.reply(textoPerfil);
      return;
    }

    if (
      comando === "QUIERO PLAN GRATIS" ||
      comando === "QUIERO PLAN BASICO" ||
      comando === "QUIERO PLAN PRO"
    ) {
      if (!planCtx.usuario?.id) {
        await msg.reply("Primero completamos tu registro. Escribime cualquier mensaje y arrancamos el onboarding.");
        return;
      }
      const planObjetivo = comando.endsWith("PRO")
        ? "pro"
        : comando.endsWith("BASICO")
        ? "basico"
        : "gratis";
      const actualizado = await actualizarPlanPorWhatsapp({
        whatsapp: msg.from,
        plan: planObjetivo,
      });
      if (!actualizado) {
        await msg.reply("No pude actualizar tu plan en este momento. Probá nuevamente en unos minutos.");
        return;
      }
      const txtPlan = String(actualizado.plan || planObjetivo).toUpperCase();
      const beneficios =
        txtPlan === "PRO"
          ? "Incluye resumen diario, alertas y modulo financiero. Precio: $18.000/mes."
          : txtPlan === "BASICO"
          ? "Incluye resumen diario y alertas de precio. Precio: $9.000/mes."
          : "Incluye resumen semanal y consultas limitadas. Precio: $0/mes.";
      await msg.reply(`✅ Plan actualizado: *${txtPlan}*.\n${beneficios}`);
      return;
    }

    const respuestaAdmin = await responderComandoAdmin(msg.from, comando);
    if (respuestaAdmin) {
      await msg.reply(respuestaAdmin);
      console.log(`[WhatsApp] Comando admin aplicado para ${msg.from}: ${comando}`);
      return;
    }

    if (comando.startsWith("RESET ONBOARDING")) {
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
          "",
          "El próximo mensaje de ese número iniciará onboarding desde cero.",
        ].join("\n")
      );
      return;
    }

    if (comandoNatural === "__ZONAS__" && planCtx.usuario?.id) {
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
      await msg.reply(flujoCompletarPerfil.respuesta);
      console.log(`[WhatsApp] Flujo COMPLETAR PERFIL para ${msg.from}`);
      return;
    }

    const respuestaComando = await manejarComandoBot(msg.from, consulta);
    if (respuestaComando) {
      await msg.reply(respuestaComando);
      console.log(`[WhatsApp] Comando bot aplicado para ${msg.from}`);
      return;
    }

    if (comando === "MIS ALERTAS") {
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

    if (comando.startsWith("CANCELAR ALERTA")) {
      if (!puedeUsarAlertas(planCtx.planEfectivo)) {
        await msg.reply("Tu plan actual no incluye alertas de precio.");
        return;
      }
      const id = consulta.match(/(\d+)/)?.[1];
      const r = await cancelarAlerta(msg.from, id);
      await msg.reply(r);
      return;
    }

    if (comando.startsWith("ALERTA") || comando.startsWith("AVISAME")) {
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
      comando.startsWith("GASTE") ||
      comando.startsWith("GASTÉ") ||
      comando.startsWith("COMPRE") ||
      comando.startsWith("COMPRÉ") ||
      comandoNatural === "__GASTO__"
    ) {
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

    if (comando.startsWith("VENDI") || comando.startsWith("VENDÍ") || comandoNatural === "__VENTA__") {
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

    if (comando === "MIS GASTOS") {
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply("Esta funcionalidad está disponible en Plan Pro.");
        return;
      }
      const r = await obtenerTextoMisGastos(msg.from);
      await msg.reply(r);
      return;
    }

    if (comando === "MIS VENTAS") {
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply("Esta funcionalidad está disponible en Plan Pro.");
        return;
      }
      const r = await obtenerTextoMisVentas(msg.from);
      await msg.reply(r);
      return;
    }

    if (comando === "MI MARGEN") {
      if (!puedeUsarFinanzas(planCtx.planEfectivo)) {
        await msg.reply("Esta funcionalidad está disponible en Plan Pro.");
        return;
      }
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
      const generado = await renderTemplate("mi_resumen", usuario);
      await msg.reply(generado.mensaje);
      console.log(`[WhatsApp] Resumen manual enviado a ${msg.from}`);
      return;
    }

    // Modo estricto: si parece intención de comando, NO pasar a IA libre.
    const sugerencia = sugerirComandoPorTexto(consulta);
    if (sugerencia || comandoNatural) {
      await msg.reply(
        sugerencia ||
          "Detecté que querés usar un comando. Escribí *VER COMANDOS* y te muestro la lista completa."
      );
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
      if (onboarding.respuesta) {
        await msg.reply(onboarding.respuesta);
      }
      console.log(`[WhatsApp] Onboarding en curso para ${msg.from}`);
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
  const destinoRaw = String(numero).trim();
  const numeroLimpio = destinoRaw.replace(/\D/g, "");
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

  // Si llega un JID directo (@c.us o @lid), intentamos enviar directo.
  if (destinoRaw.includes("@")) {
    return client.sendMessage(destinoRaw, String(mensaje));
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
