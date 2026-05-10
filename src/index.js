require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const crypto = require("crypto");
const fs = require("fs/promises");
const { query, testConnection } = require("./config/database");
const { sincronizarPreciosBoletinBcr } = require("./jobs/syncBcrBoletin");
const { ejecutarPipelineDiario } = require("./jobs/pipelineDiario");
const {
  ejecutarRecolectorDiario,
  iniciarCronRecolector,
} = require("./jobs/recolector");
const { iniciarCronEnviador } = require("./jobs/enviador");
const { obtenerDatosUltimoBoletin } = require("./scrapers/bcrBoletin");
const { generarResumenMercado } = require("./services/gemini");
const { generarResumen, marcarResumenEnviado } = require("./services/resumen");
const {
  buscarPorWhatsapp,
  actualizarUsuario,
  setActivoUsuario,
  eliminarUsuarioSoft,
} = require("./models/usuario");
const {
  initializeWhatsApp,
  obtenerEstadoWhatsapp,
  obtenerEstadoWhatsappDetalle,
  sendMessage,
  enviarCambioPlanWhatsapp,
  getRutaQrWhatsappPng,
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
const path = require("path");
const {
  getAdminDashboard,
  getUltimosUsuarios,
  getAdminUserDetail,
  getPendientesRegistro,
  getClienteDashboard,
  iniciarEnvioMasivoAdminAsync,
  obtenerEstadoEnvioMasivoJob,
} = require("./services/dashboard");
const {
  CLIENT_SESSION_COOKIE,
  CLIENT_SESSION_TTL_MS,
  autenticarCliente,
  leerSesionCliente,
  invalidarSesionCliente,
  cambiarPasswordCliente,
  limpiarSesionesExpiradas,
  ejecutarReenvioPasswordPanelCliente,
  normalizarTelefono,
} = require("./services/cliente_auth");
const { renderTemplate } = require("./templates");
const { getCasosReales } = require("./services/casosReales");
const {
  obtenerPrecipitacionesNacionales,
  LOCALIDADES,
} = require("./services/precipitaciones");
const { procesarWebhookSuscripcion, reconciliarSuscripcionesPendientes } = require("./services/mercado_pago");
const { verificarFuentes, flattenFuentes, obtenerEstadoFuentes } = require("./services/fuentes_monitor");
const {
  obtenerPreciosPapa,
  obtenerAnalisisPapa,
  crearAlertaHorticola,
  correrFetchPapaManual,
  deduplicarPreciosPapaHorticolas,
} = require("./services/horticola");
const COMANDOS = require("./config/comandos");
const {
  listarLotesUsuario: invListarLotes,
  crearLoteUsuario: invCrearLote,
  listarCampanasUsuario: invListarCampanas,
  crearCampanaUsuario: invCrearCampana,
  listarSaldos: invListarSaldos,
  listarMovimientos: invListarMovimientos,
  registroConfirmadoDirecto: invRegistroDirecto,
} = require("./services/inventario/core");

app.use(cors());
app.use(express.json());

const ADMIN_SESSION_COOKIE = "ah_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const CLIENT_LOGIN_RATE_LIMIT_WINDOW_MS = Number(
  process.env.CLIENT_LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000
);
const CLIENT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.CLIENT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 5);
const CLIENT_PASSWORD_RESET_WINDOW_MS = Number(
  process.env.CLIENT_PASSWORD_RESET_WINDOW_MS || 60 * 60 * 1000
);
const CLIENT_PASSWORD_RESET_MAX = Number(process.env.CLIENT_PASSWORD_RESET_MAX || 3);
const passwordResetAttemptsByKey = new Map();
const LOGIN_REDIRECT_TARGETS = new Set([
  "/dashboard/admin",
  "/dashboard/comandos",
  "/dashboard/templates",
  "/dashboard/usuarios",
  "/dashboard/metricas",
  "/dashboard/precios",
  "/admin.html",
  "/comandos.html",
  "/templates.html",
  "/usuarios.html",
  "/metricas.html",
  "/precios.html",
]);
const CLIENT_LOGIN_REDIRECT_TARGETS = new Set([
  "/dashboard/cliente",
  "/cliente.html",
]);
const loginAttemptsByKey = new Map();

const parseCookies = (cookieHeader = "") => {
  const out = {};
  String(cookieHeader || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return;
      const k = decodeURIComponent(pair.slice(0, eq).trim());
      const v = decodeURIComponent(pair.slice(eq + 1).trim());
      out[k] = v;
    });
  return out;
};

const signSession = (payloadB64, secret) =>
  crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");

const createSessionToken = ({ secret, issuedAt = Date.now() }) => {
  const payload = { iat: issuedAt, exp: issuedAt + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = signSession(payloadB64, secret);
  return `${payloadB64}.${sig}`;
};

const readAdminSession = (req) => {
  const secret = process.env.ADMIN_KEY?.trim();
  if (!secret) return { ok: false, reason: "no_admin_key" };
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token || !token.includes(".")) return { ok: false, reason: "missing_cookie" };
  const [payloadB64, sig] = token.split(".");
  const expectedSig = signSession(payloadB64, secret);
  if (!sig || sig.length !== expectedSig.length) {
    return { ok: false, reason: "invalid_signature" };
  }
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return { ok: false, reason: "invalid_signature" };
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload?.exp || Date.now() > Number(payload.exp)) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, payload };
  } catch (_error) {
    return { ok: false, reason: "invalid_payload" };
  }
};

const setSessionCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(isProd ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
};

const clearSessionCookie = (res) => {
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(isProd ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
};

const setClienteSessionCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${CLIENT_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.floor(CLIENT_SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(isProd ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
};

const clearClienteSessionCookie = (res) => {
  const isProd = process.env.NODE_ENV === "production";
  const attrs = [
    `${CLIENT_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    ...(isProd ? ["Secure"] : []),
  ];
  res.setHeader("Set-Cookie", attrs.join("; "));
};

const requireAdminPageAuth = (req, res, next) => {
  const ses = readAdminSession(req);
  if (ses.ok) return next();
  const nextPath = encodeURIComponent(req.originalUrl || req.path || "/dashboard/admin");
  return res.redirect(`/login?next=${nextPath}`);
};

const requireAdminApiAuth = (req, res, next) => {
  const adminKey = process.env.ADMIN_KEY?.trim();
  if (!adminKey) {
    return res.status(500).json({ ok: false, error: "ADMIN_KEY no configurada en servidor" });
  }
  const ses = readAdminSession(req);
  if (ses.ok) return next();
  const headerKey = req.header("x-admin-key");
  if (headerKey && headerKey === adminKey) return next();
  return res.status(401).json({ ok: false, error: "No autorizado" });
};

const buildClientLoginRedirect = (req) => {
  const nextPath = encodeURIComponent(req.originalUrl || req.path || "/dashboard/cliente");
  return `/dashboard/cliente/login?next=${nextPath}`;
};

const requireClientePageAuth = async (req, res, next) => {
  const ses = await leerSesionCliente(req);
  if (ses.ok) return next();
  return res.redirect(buildClientLoginRedirect(req));
};

const requireClienteApiAuth = ({ requirePasswordChanged = true } = {}) => async (req, res, next) => {
  const ses = await leerSesionCliente(req);
  if (!ses.ok) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  if (requirePasswordChanged && ses.mustChangePassword) {
    return res.status(403).json({
      ok: false,
      error: "Debes cambiar tu contraseña antes de continuar",
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  }
  req.clienteSession = ses;
  return next();
};

const clientRateLimitKey = (req, telefono) => {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || "").trim();
  return `${ip}|${String(telefono || "").replace(/\D/g, "")}`;
};

const isClientLoginLimited = (key) => {
  const now = Date.now();
  const rec = loginAttemptsByKey.get(key);
  if (!rec) return false;
  if (now - rec.first > CLIENT_LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttemptsByKey.delete(key);
    return false;
  }
  return rec.count >= CLIENT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS;
};

const registerClientLoginFailed = (key) => {
  const now = Date.now();
  const rec = loginAttemptsByKey.get(key);
  if (!rec || now - rec.first > CLIENT_LOGIN_RATE_LIMIT_WINDOW_MS) {
    loginAttemptsByKey.set(key, { first: now, count: 1 });
    return;
  }
  rec.count += 1;
  loginAttemptsByKey.set(key, rec);
};

const clearClientLoginAttempts = (key) => {
  loginAttemptsByKey.delete(key);
};

const isPasswordResetLimited = (key) => {
  const now = Date.now();
  const rec = passwordResetAttemptsByKey.get(key);
  if (!rec) return false;
  if (now - rec.first > CLIENT_PASSWORD_RESET_WINDOW_MS) {
    passwordResetAttemptsByKey.delete(key);
    return false;
  }
  return rec.count >= CLIENT_PASSWORD_RESET_MAX;
};

const registerPasswordResetAttempt = (key) => {
  const now = Date.now();
  const rec = passwordResetAttemptsByKey.get(key);
  if (!rec || now - rec.first > CLIENT_PASSWORD_RESET_WINDOW_MS) {
    passwordResetAttemptsByKey.set(key, { first: now, count: 1 });
    return;
  }
  rec.count += 1;
  passwordResetAttemptsByKey.set(key, rec);
};

app.use(async (req, res, next) => {
  if (LOGIN_REDIRECT_TARGETS.has(req.path) || req.path.startsWith("/api/dashboard/admin")) {
    if (req.path.startsWith("/api/dashboard/admin")) {
      return requireAdminApiAuth(req, res, next);
    }
    return requireAdminPageAuth(req, res, next);
  }
  if (CLIENT_LOGIN_REDIRECT_TARGETS.has(req.path)) {
    return requireClientePageAuth(req, res, next);
  }
  if (
    req.path === "/api/dashboard/cliente" ||
    req.path === "/api/dashboard/cliente/perfil" ||
    req.path.startsWith("/api/inventario/")
  ) {
    return requireClienteApiAuth({ requirePasswordChanged: true })(req, res, next);
  }
  if (req.path === "/api/comandos") {
    return requireAdminApiAuth(req, res, next);
  }
  return next();
});

app.use(express.static(path.join(__dirname, "..", "frontend", "public")));

app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "login.html"));
});

app.post("/api/auth/admin/login", async (req, res) => {
  try {
    const adminKey = process.env.ADMIN_KEY?.trim();
    if (!adminKey) {
      return res.status(500).json({ ok: false, error: "ADMIN_KEY no configurada en servidor" });
    }
    const key = String(req.body?.adminKey || "").trim();
    if (!key || key !== adminKey) {
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }
    const token = createSessionToken({ secret: adminKey });
    setSessionCookie(res, token);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/admin/logout", async (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

app.get("/api/auth/admin/session", async (req, res) => {
  const ses = readAdminSession(req);
  return res.json({ ok: ses.ok, expiresAt: ses.payload?.exp || null });
});

app.post("/api/auth/cliente/solicitar-password", async (req, res) => {
  try {
    const telefono = String(req.body?.telefono || "").trim();
    const norm = normalizarTelefono(telefono);
    if (!norm || norm.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "Ingresá un número de WhatsApp válido (solo dígitos, ej. 54911…).",
      });
    }
    const key = clientRateLimitKey(req, telefono);
    if (isPasswordResetLimited(key)) {
      return res.status(429).json({
        ok: false,
        error: "Demasiadas solicitudes desde esta conexión. Probá de nuevo en una hora.",
      });
    }
    registerPasswordResetAttempt(key);
    await ejecutarReenvioPasswordPanelCliente({ telefonoRaw: telefono });
    return res.json({
      ok: true,
      message:
        "Si tu número está en AgroHabilis, en breve recibís un WhatsApp con una contraseña temporal. Revisá el chat del mismo número.",
    });
  } catch (error) {
    console.error("Fallo /api/auth/cliente/solicitar-password:", error.message);
    return res.status(503).json({
      ok: false,
      error:
        error.message?.includes("WhatsApp") || error.message?.includes("listo")
          ? "WhatsApp no está disponible ahora. Reintentá más tarde o contactá soporte."
          : "No pudimos completar el envío. Reintentá en unos minutos.",
    });
  }
});

app.post("/api/auth/cliente/login", async (req, res) => {
  try {
    const telefono = String(req.body?.telefono || "");
    const password = String(req.body?.password || "");
    const key = clientRateLimitKey(req, telefono);
    if (isClientLoginLimited(key)) {
      return res.status(429).json({ ok: false, error: "Demasiados intentos. Probá nuevamente en unos minutos." });
    }
    const out = await autenticarCliente({
      telefono,
      password,
      ip: String(req.headers["x-forwarded-for"] || req.ip || req.socket?.remoteAddress || ""),
      userAgent: String(req.headers["user-agent"] || ""),
    });
    if (!out.ok) {
      registerClientLoginFailed(key);
      return res.status(401).json({ ok: false, error: "Credenciales inválidas" });
    }
    clearClientLoginAttempts(key);
    setClienteSessionCookie(res, out.sessionToken);
    return res.json({
      ok: true,
      session: {
        expiresAt: out.expiresAt,
        mustChangePassword: out.mustChangePassword,
        user: out.usuario,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/auth/cliente/logout", async (req, res) => {
  try {
    const ses = await leerSesionCliente(req);
    if (ses.ok && ses.token) {
      await invalidarSesionCliente(ses.token);
    }
    clearClienteSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    clearClienteSessionCookie(res);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/auth/cliente/session", async (req, res) => {
  const ses = await leerSesionCliente(req);
  if (!ses.ok) return res.json({ ok: false });
  return res.json({
    ok: true,
    session: {
      expiresAt: ses.expiresAt,
      mustChangePassword: ses.mustChangePassword,
      user: ses.user,
    },
  });
});

app.post("/api/auth/cliente/password", requireClienteApiAuth({ requirePasswordChanged: false }), async (req, res) => {
  try {
    const passwordActual = String(req.body?.passwordActual || "");
    const passwordNueva = String(req.body?.passwordNueva || "");
    if (passwordNueva.length < 8) {
      return res.status(400).json({ ok: false, error: "La nueva contraseña debe tener al menos 8 caracteres" });
    }
    const out = await cambiarPasswordCliente({
      usuarioId: req.clienteSession.user.id,
      passwordActual,
      passwordNueva,
    });
    if (!out.ok) {
      return res.status(401).json({ ok: false, error: "No se pudo cambiar la contraseña" });
    }
    clearClienteSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "AgroHabilis",
    version: "1.0.0",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "AgroHabilis",
    version: "1.0.0",
  });
});

app.post("/webhooks/mercadopago", async (req, res) => {
  try {
    const out = await procesarWebhookSuscripcion({ req });
    return res.status(200).json(out);
  } catch (error) {
    console.error("Fallo webhook Mercado Pago:", error.message);
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/suscripcion/ok", (_req, res) => {
  const whatsappReturnUrl = String(process.env.WHATSAPP_RETURN_URL || "https://wa.me/?text=Hola%20AgroHabilis").trim();
  return res
    .status(200)
    .send(
      [
        "<!doctype html>",
        '<html lang="es">',
        "<head>",
        '  <meta charset="utf-8" />',
        '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
        "  <title>Suscripción en proceso | AgroHabilis</title>",
        "  <style>",
        "    body { font-family: Arial, sans-serif; margin: 0; background: #f6f7fb; color: #1f2937; }",
        "    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }",
        "    .card { max-width: 640px; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }",
        "    h1 { margin: 0 0 12px; font-size: 24px; }",
        "    p { margin: 0 0 10px; line-height: 1.5; }",
        "    .ok { color: #0a7a36; font-weight: 700; }",
        "    .cta { display:inline-block; margin-top: 8px; padding: 10px 14px; border-radius: 8px; background:#0f5fd6; color:#fff; text-decoration:none; font-weight:600; }",
        "    .cta.secondary { background:#1f2937; margin-left:8px; }",
        "    ul { margin: 8px 0 14px 18px; line-height: 1.5; }",
        "    .note { color: #4b5563; font-size: 14px; }",
        "  </style>",
        "</head>",
        "<body>",
        '  <main class="wrap">',
        '    <section class="card">',
        '      <h1 class="ok">Suscripción recibida</h1>',
        "      <p>Gracias. Estamos procesando la confirmación del pago.</p>",
        "      <p>Cuando Mercado Pago la confirme, activamos tu plan automáticamente.</p>",
        "      <p>Con tu Plan Pro también podés gestionar todo desde tu panel de cliente:</p>",
        "      <ul>",
        "        <li>Perfil y configuración comercial.</li>",
        "        <li>Resumen de actividad y estado de tu cuenta.</li>",
        "        <li>Comandos disponibles y atajos para usar por WhatsApp.</li>",
        "      </ul>",
        '      <p><a class="cta" href="/dashboard/cliente">Ir a mi panel de cliente</a><a class="cta secondary" href="' +
          whatsappReturnUrl +
          '">Volver a WhatsApp</a></p>',
        "      <p class=\"note\">Ingresás con tu teléfono y la contraseña enviada por WhatsApp.</p>",
        "      <p class=\"note\">Si todavía no la recibiste, pedila por WhatsApp y te la reenviamos.</p>",
        "      <p>Podés volver a WhatsApp y seguir usando AgroHabilis.</p>",
        "    </section>",
        "  </main>",
        "</body>",
        "</html>",
      ].join("\n")
    );
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "index.html"));
});

app.get("/dashboard/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "admin.html"));
});

app.get("/dashboard/cliente", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "cliente.html"));
});

app.get("/dashboard/cliente/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "cliente-login.html"));
});

app.get("/dashboard/comandos", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "comandos.html"));
});

app.get("/dashboard/templates", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "templates.html"));
});

app.get("/dashboard/usuarios", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "usuarios.html"));
});

app.get("/dashboard/metricas", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "metricas.html"));
});

app.get("/dashboard/precios", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "precios.html"));
});

app.get("/casos-reales", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "casos-reales.html"));
});

app.get("/api/comandos", (_req, res) => {
  return res.json({ ok: true, data: COMANDOS });
});

app.get("/api/casos-reales", async (_req, res) => {
  try {
    const data = await getCasosReales();
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Fallo api casos-reales:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/papa/precios", async (req, res) => {
  try {
    const mercado = String(req.query.mercado || "MCBA").trim().toUpperCase();
    const variedad = req.query.variedad ? String(req.query.variedad).trim() : null;
    const fecha = req.query.fecha ? String(req.query.fecha).trim() : null;
    const rows = await obtenerPreciosPapa({ mercado, variedad, fecha });
    const data = rows.map((r) => ({
      ...r,
      referencia_debil: String(r.tipo_precio || "").toLowerCase() !== "operacion_real",
      warning:
        String(r.tipo_precio || "").toLowerCase() !== "operacion_real"
          ? "Precio de referencia (no confirmado como operación real)."
          : null,
    }));
    return res.json({ ok: true, data, filtros: { mercado, variedad, fecha } });
  } catch (error) {
    console.error("Fallo api papa/precios:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/papa/analisis", async (req, res) => {
  try {
    const mercado = String(req.query.mercado || "MCBA").trim().toUpperCase();
    const fecha = req.query.fecha ? String(req.query.fecha).trim() : null;
    const data = await obtenerAnalisisPapa({ mercado, fecha });
    return res.json({ ok: true, data, filtros: { mercado, fecha } });
  } catch (error) {
    console.error("Fallo api papa/analisis:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/papa/fetch/run", async (_req, res) => {
  try {
    const out = await correrFetchPapaManual({});
    return res.json(out);
  } catch (error) {
    console.error("Fallo api papa/fetch/run:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/papa/dedupe/run", async (req, res) => {
  try {
    const fecha = req.body?.fecha ? String(req.body.fecha).trim() : null;
    const mercado = String(req.body?.mercado || "MCBA").trim().toUpperCase();
    const eliminados = await deduplicarPreciosPapaHorticolas({ fecha, mercado });
    return res.json({ ok: true, mercado, fecha, eliminados });
  } catch (error) {
    console.error("Fallo api papa/dedupe/run:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/alertas", async (req, res) => {
  try {
    const producto = String(req.body?.producto || "papa").trim().toLowerCase();
    const condicion = String(req.body?.condicion || "").trim();
    const usuario = String(req.body?.usuario || "").trim();
    if (!usuario || !condicion) {
      return res.status(400).json({ ok: false, error: "Faltan usuario o condicion" });
    }
    const alerta = await crearAlertaHorticola({
      usuarioRef: usuario,
      producto,
      condicion,
    });
    return res.json({ ok: true, alerta });
  } catch (error) {
    console.error("Fallo api alertas horticolas:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/clima/precipitaciones", async (req, res) => {
  try {
    const ciudad = String(req.query.ciudad || "").trim();
    const zona = String(req.query.zona || "").trim();
    const region = String(req.query.region || "").trim();
    const data = await obtenerPrecipitacionesNacionales({ ciudad, zona, region });
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Fallo api precipitaciones:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/clima/precipitaciones/cobertura", (_req, res) => {
  const regiones = [...new Set(LOCALIDADES.map((x) => x.region))].sort();
  const zonas = [...new Set(LOCALIDADES.map((x) => x.zona))].sort();
  return res.json({
    ok: true,
    totalLocalidades: LOCALIDADES.length,
    regiones,
    zonas,
    localidades: LOCALIDADES.map((x) => ({
      ciudad: x.ciudad,
      provincia: x.provincia,
      zona: x.zona,
      region: x.region,
    })),
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
          "No hay usuario sistema para guardar resumenes. Ejecuta: node scripts/db/setup-db.js"
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

app.post("/api/admin/recolectar", async (req, res) => {
  try {
    const ses = readAdminSession(req);
    if (!ses.ok) {
      const adminKey = process.env.ADMIN_KEY?.trim();
      const headerKey = req.header("x-admin-key");
      if (!adminKey) {
        return res
          .status(500)
          .json({ ok: false, error: "ADMIN_KEY no configurada en servidor" });
      }
      if (!headerKey || headerKey !== adminKey) {
        return res.status(401).json({ ok: false, error: "No autorizado" });
      }
    }

    const resultado = await ejecutarRecolectorDiario();
    return res.json({ ok: resultado.ok, recolector: resultado });
  } catch (error) {
    console.error("Fallo recolector manual:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/admin/enviar-resumen", async (req, res) => {
  try {
    const ses = readAdminSession(req);
    if (!ses.ok) {
      const adminKey = process.env.ADMIN_KEY?.trim();
      const headerKey = req.header("x-admin-key");
      if (!adminKey) {
        return res
          .status(500)
          .json({ ok: false, error: "ADMIN_KEY no configurada en servidor" });
      }
      if (!headerKey || headerKey !== adminKey) {
        return res.status(401).json({ ok: false, error: "No autorizado" });
      }
    }

    const numero = String(req.body?.whatsapp || "").trim();
    if (!numero) {
      return res.status(400).json({ ok: false, error: "Falta body.whatsapp" });
    }

    const usuario = await buscarPorWhatsapp(numero);
    if (!usuario) {
      return res
        .status(404)
        .json({ ok: false, error: "No existe usuario para ese whatsapp" });
    }

    const generado = await generarResumen(usuario.id);
    const envio = await sendMessage(usuario.whatsapp, generado.texto);
    await marcarResumenEnviado(generado.resumenId);

    return res.json({
      ok: true,
      resumenId: generado.resumenId,
      model: generado.model,
      tokensUsados: generado.tokensUsados,
      mensajeId: envio.id?._serialized || null,
      resumen: generado.texto,
    });
  } catch (error) {
    console.error("Fallo enviar resumen admin:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/admin/estado", async (req, res) => {
  try {
    const ses = readAdminSession(req);
    if (!ses.ok) {
      const adminKey = process.env.ADMIN_KEY?.trim();
      const headerKey = req.header("x-admin-key");
      if (!adminKey) {
        return res
          .status(500)
          .json({ ok: false, error: "ADMIN_KEY no configurada en servidor" });
      }
      if (!headerKey || headerKey !== adminKey) {
        return res.status(401).json({ ok: false, error: "No autorizado" });
      }
    }

    const ultimaRecoleccion = await query(
      "SELECT MAX(creado_en) AS ts FROM precios"
    );
    const usuariosActivos = await query(
      "SELECT COUNT(*)::int AS total FROM usuarios WHERE activo = true"
    );
    const resumenesHoy = await query(
      `
        SELECT COUNT(*)::int AS total
        FROM resumenes
        WHERE fecha = CURRENT_DATE
          AND enviado_wp = true
      `
    );

    return res.json({
      whatsapp: obtenerEstadoWhatsapp(),
      whatsappDetalle: obtenerEstadoWhatsappDetalle(),
      ultimaRecoleccion: ultimaRecoleccion.rows[0]?.ts || null,
      usuariosActivos: usuariosActivos.rows[0]?.total || 0,
      resumenesHoy: resumenesHoy.rows[0]?.total || 0,
      cronRecolector: "activo",
      cronEnviador: "activo",
    });
  } catch (error) {
    console.error("Fallo estado admin:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/resumen", async (req, res) => {
  try {
    const data = await getAdminDashboard();
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Fallo dashboard admin resumen:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/usuarios", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const usuarios = await getUltimosUsuarios(limit);
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, usuarios });
  } catch (error) {
    console.error("Fallo dashboard admin usuarios:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/envio-masivo", async (req, res) => {
  try {
    const usuarioIds = Array.isArray(req.body?.usuarioIds) ? req.body.usuarioIds : [];
    const mensaje = String(req.body?.mensaje ?? "");
    const { jobId, total } = iniciarEnvioMasivoAdminAsync({ usuarioIds, mensaje });
    return res.status(202).json({ ok: true, jobId, total, mensaje: "Encolado; consultá estado con jobId." });
  } catch (error) {
    console.error("Fallo dashboard admin envio-masivo:", error.message);
    const status = /vacío|Sin destinatarios/i.test(error.message) ? 400 : 500;
    return res.status(status).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/envio-masivo/estado", async (req, res) => {
  try {
    const jobId = String(req.query.jobId || "").trim();
    if (!jobId) {
      return res.status(400).json({ ok: false, error: "Falta query.jobId" });
    }
    const job = obtenerEstadoEnvioMasivoJob(jobId);
    if (!job) {
      return res.status(404).json({ ok: false, error: "Job no encontrado o expirado" });
    }
    return res.json({ ok: true, jobId, ...job });
  } catch (error) {
    console.error("Fallo dashboard admin envio-masivo estado:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/whatsapp-qr.png", async (req, res) => {
  try {
    const abs = getRutaQrWhatsappPng();
    try {
      await fs.access(abs);
    } catch (_e) {
      return res.status(404).json({
        ok: false,
        error:
          "Aún no hay archivo de QR en disco. Esperá unos segundos tras reiniciar el servicio o revisá logs / WHATSAPP_QR_PNG en el servidor.",
      });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.sendFile(abs);
  } catch (error) {
    console.error("Fallo dashboard admin whatsapp-qr.png:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/usuario-detalle", async (req, res) => {
  try {
    const usuarioId = req.query.usuarioId ? Number(req.query.usuarioId) : null;
    const whatsapp = req.query.whatsapp ? String(req.query.whatsapp) : null;
    if (!usuarioId && !whatsapp) {
      return res.status(400).json({ ok: false, error: "Falta query.usuarioId o query.whatsapp" });
    }

    const detalle = await getAdminUserDetail({ usuarioId, whatsapp });
    if (!detalle) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }
    return res.json({ ok: true, detalle });
  } catch (error) {
    console.error("Fallo dashboard admin usuario-detalle:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/pendientes", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const items = await getPendientesRegistro(limit);
    return res.json({ ok: true, items });
  } catch (error) {
    console.error("Fallo dashboard admin pendientes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/precios", async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 300);
    const offsetRaw = Number(req.query.offset || 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.round(limitRaw))) : 300;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.round(offsetRaw)) : 0;
    const q = String(req.query.q || "").trim();
    const categoria = String(req.query.categoria || "").trim().toLowerCase();
    const plaza = String(req.query.plaza || "").trim();

    const latest = await query(
      `
        SELECT id, fecha, hora, total_items, datos_completos
        FROM mercado_snapshot
        ORDER BY fecha DESC, hora DESC
        LIMIT 1
      `
    );
    const snapshot = latest.rows[0] || null;

    if (!snapshot) {
      return res.json({
        ok: true,
        snapshot: null,
        total: 0,
        rows: [],
      });
    }

    const where = ["msi.snapshot_id = $1"];
    const params = [snapshot.id];
    let idx = 2;
    if (q) {
      where.push(
        `(msi.producto ILIKE $${idx} OR COALESCE(msi.plaza,'') ILIKE $${idx} OR COALESCE(msi.fuente,'') ILIKE $${idx})`
      );
      params.push(`%${q}%`);
      idx += 1;
    }
    if (categoria) {
      where.push(`LOWER(COALESCE(msi.categoria,'')) = $${idx}`);
      params.push(categoria);
      idx += 1;
    }
    if (plaza) {
      where.push(`COALESCE(msi.plaza,'') ILIKE $${idx}`);
      params.push(`%${plaza}%`);
      idx += 1;
    }

    const whereSql = where.join(" AND ");
    const totalR = await query(
      `SELECT COUNT(*)::int AS total FROM mercado_snapshot_items msi WHERE ${whereSql}`,
      params
    );
    const total = Number(totalR.rows[0]?.total || 0);

    const rows = await query(
      `
        SELECT
          msi.id,
          msi.categoria,
          msi.subcategoria,
          msi.producto,
          msi.plaza,
          msi.region,
          msi.precio,
          msi.precio_usd,
          msi.moneda,
          msi.unidad,
          msi.posicion,
          msi.destino,
          msi.distancia_km,
          msi.fuente,
          msi.confiabilidad,
          msi.creado_en
        FROM mercado_snapshot_items msi
        WHERE ${whereSql}
        ORDER BY msi.categoria, msi.producto, msi.plaza NULLS LAST, msi.id DESC
        LIMIT $${idx} OFFSET $${idx + 1}
      `,
      [...params, limit, offset]
    );

    return res.json({
      ok: true,
      snapshot,
      total,
      limit,
      offset,
      rows: rows.rows,
    });
  } catch (error) {
    console.error("Fallo dashboard admin precios:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/fuentes-matriz", async (_req, res) => {
  try {
    const fuentes = flattenFuentes();
    const estado = await obtenerEstadoFuentes();
    const statusById = new Map((estado?.activas || []).map((x) => [x.id, x.status || "sin_verificar"]));

    const categorias = [...new Set(fuentes.map((f) => String(f.categoria || "general")))].sort();
    const grouped = new Map();
    for (const f of fuentes) {
      if (!f?.id) continue;
      if (!grouped.has(f.id)) {
        grouped.set(f.id, {
          id: f.id,
          nombre: f.nombre || f.id,
          url: f.url || "",
          oficial: Boolean(f.oficial),
          activa: Boolean(f.activa),
          status: statusById.get(f.id) || "sin_verificar",
          categoriasSet: new Set(),
          grupos: new Set(),
        });
      }
      const row = grouped.get(f.id);
      row.categoriasSet.add(String(f.categoria || "general"));
      row.grupos.add(String(f.grupo || "principal"));
    }

    const rows = [...grouped.values()]
      .map((r) => ({
        id: r.id,
        nombre: r.nombre,
        url: r.url,
        oficial: r.oficial,
        activa: r.activa,
        status: r.status,
        prioridad: r.prioridad || "media",
        metodoPreferido: r.metodo_preferido || r.tipo || "n/d",
        ordenIngesta: Number.isFinite(Number(r.orden_ingesta)) ? Number(r.orden_ingesta) : null,
        grupos: [...r.grupos].sort(),
        categorias: categorias.reduce((acc, c) => {
          acc[c] = r.categoriasSet.has(c);
          return acc;
        }, {}),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    return res.json({ ok: true, categorias, rows });
  } catch (error) {
    console.error("Fallo dashboard admin fuentes-matriz:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const actualizarActivoFuenteEnArchivo = async ({ fuenteId, activa }) => {
  const content = await fs.readFile(FUENTES_CONFIG_PATH, "utf8");
  const safeId = String(fuenteId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(id:\\s*["']${safeId}["'][\\s\\S]*?activa:\\s*)(true|false)`, "m");
  if (!re.test(content)) {
    throw new Error(`Fuente no encontrada en config: ${fuenteId}`);
  }
  const next = content.replace(re, `$1${activa ? "true" : "false"}`);
  await fs.writeFile(FUENTES_CONFIG_PATH, next, "utf8");
};

app.post("/api/dashboard/admin/fuentes-accion", async (req, res) => {
  try {
    const fuenteId = String(req.body?.fuenteId || "").trim();
    const accion = String(req.body?.accion || "").trim().toLowerCase();
    if (!fuenteId || !accion) {
      return res.status(400).json({ ok: false, error: "Falta fuenteId o accion" });
    }
    if (!["activar", "desactivar"].includes(accion)) {
      return res.status(400).json({ ok: false, error: "Accion invalida. Usar: activar|desactivar" });
    }
    await actualizarActivoFuenteEnArchivo({
      fuenteId,
      activa: accion === "activar",
    });
    return res.json({ ok: true, fuenteId, activa: accion === "activar" });
  } catch (error) {
    console.error("Fallo dashboard admin fuentes-accion:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

const TEMPLATES_BASE_DIR = path.join(__dirname, "templates");
const TEMPLATES_ALLOWED_EXT = new Set([".js", ".md", ".json"]);
const FUENTES_CONFIG_PATH = path.join(__dirname, "config", "fuentes.js");

const pathInside = (target, base) => {
  const rel = path.relative(base, target);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

const safeTemplatePath = (relativePath = "") => {
  const clean = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return null;
  const abs = path.resolve(TEMPLATES_BASE_DIR, clean);
  if (!pathInside(abs, TEMPLATES_BASE_DIR)) return null;
  const ext = path.extname(abs).toLowerCase();
  if (!TEMPLATES_ALLOWED_EXT.has(ext)) return null;
  return { abs, rel: clean };
};

const listTemplateFiles = async (dirAbs, prefix = "") => {
  const entries = await fs.readdir(dirAbs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const nested = await listTemplateFiles(abs, rel);
      out.push(...nested);
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (!TEMPLATES_ALLOWED_EXT.has(ext)) continue;
    const st = await fs.stat(abs);
    out.push({
      path: rel,
      size: st.size,
      updatedAt: st.mtime.toISOString(),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
};

app.get("/api/dashboard/admin/templates", async (_req, res) => {
  try {
    const files = await listTemplateFiles(TEMPLATES_BASE_DIR);
    return res.json({ ok: true, files });
  } catch (error) {
    console.error("Fallo templates list:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/templates/file", async (req, res) => {
  try {
    const relativePath = String(req.query.path || "");
    const safe = safeTemplatePath(relativePath);
    if (!safe) return res.status(400).json({ ok: false, error: "Path inválido" });
    const content = await fs.readFile(safe.abs, "utf8");
    return res.json({ ok: true, file: { path: safe.rel, content } });
  } catch (error) {
    console.error("Fallo templates file read:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/templates/file", async (req, res) => {
  try {
    const relativePath = String(req.body?.path || "");
    const content = String(req.body?.content ?? "");
    const safe = safeTemplatePath(relativePath);
    if (!safe) return res.status(400).json({ ok: false, error: "Path inválido" });
    await fs.writeFile(safe.abs, content, "utf8");
    return res.json({ ok: true, file: { path: safe.rel } });
  } catch (error) {
    console.error("Fallo templates file save:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/templates/preview", async (req, res) => {
  try {
    const template = String(req.query.template || "").trim().toLowerCase();
    const planReq = String(req.query.plan || "").trim().toLowerCase();
    const usuarioIdReq = req.query.usuarioId ? Number(req.query.usuarioId) : null;
    const plan = ["gratis", "basico", "pro"].includes(planReq) ? planReq : "gratis";
    if (!template) {
      return res.status(400).json({ ok: false, error: "Falta query.template" });
    }

    let detalle = null;
    if (usuarioIdReq) {
      detalle = await getAdminUserDetail({ usuarioId: usuarioIdReq, whatsapp: null });
    } else {
      const recientes = await getUltimosUsuarios(1);
      const anyId = recientes?.[0]?.id ? Number(recientes[0].id) : null;
      if (anyId) detalle = await getAdminUserDetail({ usuarioId: anyId, whatsapp: null });
    }

    const usuario = detalle
      ? {
          ...detalle.usuario,
          plan,
          cultivos: (detalle.cultivos || []).filter((c) => c?.activo !== false),
          perfil_productivo: detalle.perfil?.tipo || "agricultura",
        }
      : {
          id: 1,
          nombre: "Usuario Demo",
          whatsapp: "5491111111111",
          provincia: "Buenos Aires",
          partido: "Tandil",
          lat: -37.3217,
          lng: -59.1332,
          plan,
          cultivos: [{ cultivo: "soja", activo: true }, { cultivo: "maiz", activo: true }],
          perfil_productivo: "agricultura",
        };

    const args = [];
    if (template === "alerta") {
      const cultivo = usuario.cultivos?.[0]?.cultivo || "soja";
      args.push({
        cultivo,
        tipo: "mayor_que",
        valor_objetivo: 300000,
      });
    } else if (template === "analisis_venta") {
      args.push(usuario.cultivos?.[0]?.cultivo || "soja");
    } else if (template === "consulta") {
      args.push("Quiero un panorama de precios, dolar y clima para decidir ventas.");
    }

    const out = await renderTemplate(template, usuario, ...args);
    return res.json({
      ok: true,
      preview: {
        template,
        plan,
        usuarioId: usuario.id || null,
        mensaje: out?.mensaje || "",
        meta: out?.meta || {},
      },
    });
  } catch (error) {
    console.error("Fallo templates preview:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/usuario-accion", async (req, res) => {
  try {
    const usuarioId = Number(req.body?.usuarioId);
    const accion = String(req.body?.accion || "").trim().toLowerCase();
    const planObjetivoRaw = req.body?.planObjetivo;
    if (!usuarioId || !accion) {
      return res.status(400).json({ ok: false, error: "Falta usuarioId o accion" });
    }
    if (usuarioId === 1) {
      return res.status(400).json({ ok: false, error: "No se permite modificar usuario del sistema" });
    }

    let usuario = null;
    if (accion === "pausar") {
      usuario = await setActivoUsuario(usuarioId, false);
    } else if (accion === "activar") {
      usuario = await setActivoUsuario(usuarioId, true);
    } else if (accion === "eliminar") {
      usuario = await eliminarUsuarioSoft(usuarioId);
    } else if (accion === "cambiar_plan") {
      const planObjetivo = String(planObjetivoRaw || "").trim().toLowerCase();
      if (!["gratis", "basico", "pro"].includes(planObjetivo)) {
        return res.status(400).json({ ok: false, error: "planObjetivo inválido. Usar: gratis|basico|pro" });
      }
      const rPlan = await query(
        `
          UPDATE usuarios
          SET plan = $2, plan_activo_hasta = NULL
          WHERE id = $1
          RETURNING id, nombre, whatsapp, plan, activo
        `,
        [usuarioId, planObjetivo]
      );
      usuario = rPlan.rows[0] || null;
    } else {
      return res.status(400).json({
        ok: false,
        error: "Accion invalida. Usar: activar|pausar|eliminar|cambiar_plan",
      });
    }

    if (!usuario) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }
    return res.json({ ok: true, accion, usuario });
  } catch (error) {
    console.error("Fallo dashboard admin usuario-accion:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/alerta-accion", async (req, res) => {
  try {
    const alertaId = Number(req.body?.alertaId);
    const accion = String(req.body?.accion || "").trim().toLowerCase();
    if (!alertaId || !accion) {
      return res.status(400).json({ ok: false, error: "Falta alertaId o accion" });
    }

    let result;
    if (accion === "reactivar") {
      result = await query(
        `
          UPDATE alertas
          SET activa = true, disparada = false, disparada_en = NULL
          WHERE id = $1
          RETURNING id, usuario_id, cultivo, tipo, activa, disparada
        `,
        [alertaId]
      );
    } else if (accion === "cancelar") {
      result = await query(
        `
          UPDATE alertas
          SET activa = false
          WHERE id = $1
          RETURNING id, usuario_id, cultivo, tipo, activa, disparada
        `,
        [alertaId]
      );
    } else {
      return res.status(400).json({ ok: false, error: "Accion invalida. Usar: reactivar|cancelar" });
    }

    if (!result.rows[0]) {
      return res.status(404).json({ ok: false, error: "Alerta no encontrada" });
    }
    return res.json({ ok: true, accion, alerta: result.rows[0] });
  } catch (error) {
    console.error("Fallo dashboard admin alerta-accion:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/ejecutar-cambio-plan-wsp", async (req, res) => {
  try {
    const whatsappRaw = String(req.body?.whatsapp || "").trim();
    const planObjetivo = String(req.body?.planObjetivo || "pro").trim().toLowerCase();
    if (!whatsappRaw) {
      return res.status(400).json({
        ok: false,
        error: "Falta body.whatsapp (número con código país o JID …@lid)",
      });
    }
    if (!["basico", "pro", "gratis"].includes(planObjetivo)) {
      return res.status(400).json({
        ok: false,
        error: "planObjetivo inválido. Usar: basico | pro | gratis",
      });
    }
    const resultado = await enviarCambioPlanWhatsapp({
      whatsapp: whatsappRaw,
      planObjetivo,
    });
    if (!resultado.ok) {
      const code = resultado.texto ? 502 : 422;
      return res.status(code).json({ ok: false, ...resultado });
    }
    return res.json({ ok: true, messageId: resultado.messageId });
  } catch (error) {
    console.error("Fallo ejecutar-cambio-plan-wsp:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/pendiente-accion", async (req, res) => {
  try {
    const whatsapp = String(req.body?.whatsapp || "").replace(/\D/g, "");
    const accion = String(req.body?.accion || "").trim().toLowerCase();
    if (!whatsapp || !accion) {
      return res.status(400).json({ ok: false, error: "Falta whatsapp o accion" });
    }

    if (accion === "recordar") {
      const texto =
        "Hola 👋 Te falta un paso para terminar tu registro en AgroHabilis.\n" +
        "Respondeme este mensaje y seguimos con tu onboarding ahora mismo.";
      const envio = await sendMessage(whatsapp, texto);
      return res.json({
        ok: true,
        accion,
        whatsapp,
        messageId: envio?.id?._serialized || null,
      });
    }

    if (accion === "mensaje") {
      const mensaje = String(req.body?.mensaje || "").trim();
      if (!mensaje) {
        return res.status(400).json({ ok: false, error: "Falta body.mensaje para accion=mensaje" });
      }
      const envio = await sendMessage(whatsapp, mensaje);
      return res.json({
        ok: true,
        accion,
        whatsapp,
        messageId: envio?.id?._serialized || null,
      });
    }

    if (accion === "eliminar") {
      await query(
        `
          DELETE FROM onboarding_estado
          WHERE regexp_replace(whatsapp, '\\D', '', 'g') = $1
        `,
        [whatsapp]
      );
      await query(
        `
          DELETE FROM whatsapp_bot_control
          WHERE regexp_replace(whatsapp, '\\D', '', 'g') = $1
        `,
        [whatsapp]
      );
      await query(
        `
          DELETE FROM historial_consultas
          WHERE usuario_id IS NULL
            AND regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $1
        `,
        [whatsapp]
      );
      return res.json({ ok: true, accion, whatsapp });
    }

    return res.status(400).json({ ok: false, error: "Accion invalida. Usar: recordar|mensaje|eliminar" });
  } catch (error) {
    console.error("Fallo dashboard admin pendiente-accion:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/cliente", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const data = await getClienteDashboard({ usuarioId });
    if (!data) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Fallo dashboard cliente:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventario/lotes", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const lotes = await invListarLotes(usuarioId);
    return res.json({ ok: true, lotes });
  } catch (error) {
    console.error("Fallo /api/inventario/lotes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventario/lotes", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "nombre obligatorio" });
    const hectareas =
      req.body?.hectareas === undefined || req.body?.hectareas === "" ? null : Number(req.body.hectareas);
    const cultivo = req.body?.cultivo != null ? String(req.body.cultivo).trim() : null;
    const arrendado = Boolean(req.body?.arrendado);
    const lote = await invCrearLote({
      usuarioId,
      nombre,
      hectareas: Number.isFinite(hectareas) ? hectareas : null,
      cultivo: cultivo || null,
      arrendado,
    });
    return res.json({ ok: true, lote });
  } catch (error) {
    console.error("Fallo POST /api/inventario/lotes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventario/campanas", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const rows = await invListarCampanas(usuarioId);
    return res.json({ ok: true, campanas: rows });
  } catch (error) {
    console.error("Fallo /api/inventario/campanas:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventario/campanas", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "nombre obligatorio" });
    const fi =
      req.body?.fecha_inicio !== undefined && String(req.body.fecha_inicio || "").trim() !== ""
        ? String(req.body.fecha_inicio).trim()
        : null;
    const ff =
      req.body?.fecha_fin !== undefined && String(req.body.fecha_fin || "").trim() !== ""
        ? String(req.body.fecha_fin).trim()
        : null;
    const row = await invCrearCampana({ usuarioId, nombre, fechaInicio: fi, fechaFin: ff });
    return res.json({ ok: true, campana: row });
  } catch (error) {
    console.error("Fallo POST /api/inventario/campanas:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventario/saldos", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const dominio = req.query?.dominio ? String(req.query.dominio).trim() : undefined;
    const loteIdRaw = req.query?.lote_id;
    let loteId;
    if (loteIdRaw !== undefined && loteIdRaw !== "") {
      const n = Number(loteIdRaw);
      if (!Number.isFinite(n)) return res.status(400).json({ ok: false, error: "lote_id inválido" });
      loteId = n;
    }
    const campanaIdRaw = req.query?.campana_id;
    let campanaId;
    if (campanaIdRaw !== undefined && campanaIdRaw !== "") {
      const nc = Number(campanaIdRaw);
      if (!Number.isFinite(nc)) return res.status(400).json({ ok: false, error: "campana_id inválido" });
      campanaId = nc;
    }
    const saldos = await invListarSaldos({ usuarioId, loteId, campanaId, dominio });
    return res.json({ ok: true, saldos });
  } catch (error) {
    console.error("Fallo /api/inventario/saldos:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/inventario/movimientos", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const lim = req.query?.limit ? Number(req.query.limit) : 40;
    const rows = await invListarMovimientos({ usuarioId, limit: lim });
    return res.json({ ok: true, movimientos: rows });
  } catch (error) {
    console.error("Fallo /api/inventario/movimientos:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/inventario/registro", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const dominio = String(req.body?.dominio || "").toLowerCase();
    if (!["ganado", "cultivo", "insumo", "grano"].includes(dominio)) {
      return res.status(400).json({ ok: false, error: "dominio debe ser ganado|cultivo|insumo|grano" });
    }
    const efectoRaw = String(req.body?.efecto || "replace").toLowerCase();
    const efecto = efectoRaw === "delta" ? "delta" : "replace";
    const loteIdRaw = req.body?.lote_id;
    let loteId = null;
    if (loteIdRaw !== undefined && loteIdRaw !== "" && loteIdRaw != null) {
      const n = Number(loteIdRaw);
      if (!Number.isFinite(n)) return res.status(400).json({ ok: false, error: "lote_id inválido" });
      loteId = n;
    }
    const campanaIdRaw = req.body?.campana_id;
    let campanaId = null;
    if (campanaIdRaw !== undefined && campanaIdRaw !== "" && campanaIdRaw != null) {
      const nc = Number(campanaIdRaw);
      if (!Number.isFinite(nc)) return res.status(400).json({ ok: false, error: "campana_id inválido" });
      campanaId = nc;
    }
    let payload = {};
    if (dominio === "ganado") {
      const categoria = String(req.body?.categoria || "").trim();
      const especie = String(req.body?.especie || "vacuno").trim() || "vacuno";
      if (efecto === "delta") {
        const d = Number(req.body?.delta ?? req.body?.cambio);
        if (!categoria || !Number.isFinite(d) || !Number.isInteger(Math.round(d))) {
          return res.status(400).json({ ok: false, error: "ganado delta requiere categoria y delta entero" });
        }
        payload = { especie, categoria, delta: Math.round(d) };
      } else {
        const cantidad = Number(req.body?.cantidad);
        if (!categoria || !Number.isFinite(cantidad) || cantidad < 0) {
          return res.status(400).json({ ok: false, error: "ganado replace requiere categoria y cantidad >= 0" });
        }
        payload = { especie, categoria, cantidad: Math.round(cantidad) };
      }
    } else if (dominio === "cultivo") {
      const cultivo = String(req.body?.cultivo || "").trim();
      if (!cultivo) return res.status(400).json({ ok: false, error: "cultivo obligatorio" });
      if (efecto === "delta") {
        const d = Number(req.body?.delta ?? req.body?.hectareas_delta);
        if (!Number.isFinite(d)) {
          return res.status(400).json({ ok: false, error: "cultivo delta requiere delta numérico" });
        }
        payload = { cultivo, delta: d };
      } else {
        const hectareas = Number(req.body?.hectareas);
        if (!Number.isFinite(hectareas) || hectareas <= 0) {
          return res.status(400).json({ ok: false, error: "cultivo replace requiere hectareas > 0" });
        }
        payload = { cultivo, hectareas };
      }
    } else if (dominio === "grano") {
      const cultivo = String(req.body?.cultivo || "").trim();
      if (!cultivo) return res.status(400).json({ ok: false, error: "cultivo obligatorio para grano" });
      if (efecto === "delta") {
        const d = Number(req.body?.delta ?? req.body?.delta_toneladas);
        if (!Number.isFinite(d)) {
          return res.status(400).json({ ok: false, error: "grano delta requiere delta o delta_toneladas" });
        }
        payload = { cultivo, delta: d };
      } else {
        const tn = Number(req.body?.toneladas ?? req.body?.tn);
        if (!Number.isFinite(tn) || tn < 0) {
          return res.status(400).json({ ok: false, error: "grano replace requiere toneladas o tn >= 0" });
        }
        payload = { cultivo, toneladas: tn };
      }
    } else {
      const producto = String(req.body?.producto || "").trim().slice(0, 120);
      const unidad = String(req.body?.unidad || "un").trim() || "un";
      if (!producto) return res.status(400).json({ ok: false, error: "insumo requiere producto" });
      if (efecto === "delta") {
        const din = Number(req.body?.delta);
        if (!Number.isFinite(din)) {
          return res.status(400).json({ ok: false, error: "insumo delta requiere delta" });
        }
        payload = { producto, delta: din, unidad };
      } else {
        const q = Number(req.body?.cantidad);
        if (!Number.isFinite(q) || q < 0) {
          return res.status(400).json({ ok: false, error: "insumo replace requiere cantidad >= 0" });
        }
        payload = { producto, cantidad: q, unidad };
      }
    }
    const fechaRef = req.body?.fecha_referencia ? String(req.body.fecha_referencia).trim() : undefined;
    const textoNl = req.body?.texto_nl != null ? String(req.body.texto_nl) : null;
    const idemp = req.body?.idempotency_key != null ? String(req.body.idempotency_key).trim() || null : null;
    const mov = await invRegistroDirecto({
      usuarioId,
      dominio,
      payload,
      loteId,
      campanaId,
      efecto,
      textoNl,
      fechaReferencia: fechaRef,
      canal: "web",
      idempotencyKey: idemp || null,
    });
    return res.json({ ok: true, movimiento: mov });
  } catch (error) {
    console.error("Fallo POST /api/inventario/registro:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/cliente/perfil", async (req, res) => {
  try {
    const usuario = await query(
      `
        SELECT id
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `,
      [req.clienteSession?.user?.id]
    );
    const usuarioRow = usuario.rows[0];
    if (!usuarioRow) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }

    const nombre = req.body?.nombre !== undefined ? String(req.body.nombre).trim() : undefined;
    const emailRaw = req.body?.email !== undefined ? String(req.body.email).trim() : undefined;
    const email = emailRaw === "" ? null : emailRaw;
    const provincia = req.body?.provincia !== undefined ? String(req.body.provincia).trim() : undefined;
    const partido = req.body?.partido !== undefined ? String(req.body.partido).trim() : undefined;
    const tipoCom = req.body?.tipo_comercializacion !== undefined
      ? String(req.body.tipo_comercializacion).trim().toLowerCase()
      : undefined;

    if (nombre !== undefined && !nombre) {
      return res.status(400).json({ ok: false, error: "Nombre inválido" });
    }
    if (email !== undefined && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Email inválido" });
    }
    if (
      tipoCom !== undefined &&
      !["disponible", "futuros", "mixto", "aprender"].includes(tipoCom)
    ) {
      return res.status(400).json({
        ok: false,
        error: "tipo_comercializacion inválido. Usar: disponible|futuros|mixto|aprender",
      });
    }

    const actualizado = await actualizarUsuario(usuarioRow.id, {
      nombre,
      email,
      provincia,
      partido,
      tipo_comercializacion: tipoCom,
    });
    if (!actualizado) {
      return res.status(404).json({ ok: false, error: "No se pudo actualizar usuario" });
    }
    return res.json({ ok: true, usuario: actualizado });
  } catch (error) {
    console.error("Fallo dashboard cliente perfil:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
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
  cron.schedule(
    "*/30 * * * *",
    async () => {
      try {
        const estado = await verificarFuentes();
        console.log(
          `[FuentesMonitor] Verificación OK: total=${estado.total} ok=${estado.ok} lento=${estado.lento} error=${estado.error}`
        );
      } catch (error) {
        console.error("[FuentesMonitor] Error verificando fuentes:", error.message);
      }
    },
    { timezone: tz }
  );
  cron.schedule(
    "*/10 * * * *",
    async () => {
      try {
        const out = await reconciliarSuscripcionesPendientes({ limit: 50 });
        if (out.total > 0) {
          console.log(
            `[MP Reconcile] total=${out.total} proc=${out.procesadas} auth=${out.autorizadas} cancel=${out.canceladas} pause=${out.pausadas} err=${out.errores.length}`
          );
        }
      } catch (error) {
        console.error("[MP Reconcile] Error reconciliando suscripciones:", error.message);
      }
    },
    { timezone: tz }
  );
  console.log(
    "Cron configurado: pipeline diario + monitor de fuentes cada 30 min + reconcile MP cada 10 min (AR)."
  );
};

const startServer = async () => {
  try {
    await testConnection();
  } catch (error) {
    console.error("No se pudo conectar la base de datos:", error.message);
    process.exit(1);
  }

  iniciarCronRecolector();
  iniciarCronEnviador();
  programarJobs();
  try {
    await limpiarSesionesExpiradas();
  } catch (error) {
    console.error("Limpieza inicial de sesiones cliente:", error.message);
  }
  setInterval(() => {
    limpiarSesionesExpiradas().catch((error) => {
      console.error("No se pudieron limpiar sesiones cliente:", error.message);
    });
  }, 60 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`AgroHabilis escuchando en puerto ${PORT}`);
  });

  // WhatsApp (Puppeteer) no debe bloquear el puerto HTTP: si Chromium falla o tarda,
  // nginx dejaria de tener upstream (502). El enviador espera cliente listo antes de mandar mensajes.
  initializeWhatsApp().catch((error) => {
    console.error(
      "WhatsApp no pudo inicializarse — el panel/API siguen disponibles:",
      error.message
    );
  });
};

startServer();
