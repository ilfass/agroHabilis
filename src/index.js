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
const {
  buscarPorWhatsapp,
  actualizarUsuario,
  setActivoUsuario,
  eliminarUsuarioSoft,
  destinoWhatsappParaEnvio,
} = require("./models/usuario");
const {
  initializeWhatsApp,
  obtenerEstadoWhatsapp,
  obtenerEstadoWhatsappDetalle,
  sendMessage,
  enviarCambioPlanWhatsapp,
  getRutaQrWhatsappPng,
} = require("./config/whatsapp");
const { iniciarResumen } = require("./services/resumen_interactivo");
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
  getUltimosPlanesAgente,
  getAgentRuntimeAdmin,
  getAgentColaResumen,
  getOutreachCandidatos,
} = require("./services/dashboard");
const { getAdminEditableEnv, postAdminEditableEnv } = require("./services/admin_editable_env");
const agentToolsRegistry = require("./services/agent/tools");
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
  "/dashboard/campanas",
  "/dashboard/planes",
  "/admin.html",
  "/comandos.html",
  "/templates.html",
  "/usuarios.html",
  "/metricas.html",
  "/precios.html",
  "/campanas.html",
  "/planes.html",
  "/dashboard/ia",
  "/ia.html",
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
  if (ses.ok) {
    const plan = String(ses.user?.plan || "").toLowerCase();
    if (plan === "gratis" || !plan) {
      return res.redirect("/dashboard/cliente/login?error=plan_restricted");
    }
    return next();
  }
  return res.redirect(buildClientLoginRedirect(req));
};

const requireClienteApiAuth = ({ requirePasswordChanged = true } = {}) => async (req, res, next) => {
  const ses = await leerSesionCliente(req);
  if (!ses.ok) {
    return res.status(401).json({ ok: false, error: "No autorizado" });
  }
  const plan = String(ses.user?.plan || "").toLowerCase();
  if (plan === "gratis" || !plan) {
    return res.status(403).json({
      ok: false,
      error: "El acceso al Panel Web requiere un Plan Básico o superior. ¡Podés actualizar tu plan desde WhatsApp!",
      code: "PLAN_RESTRICTED",
    });
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

// Prevent browser caching of HTML pages to ensure updates are visible immediately
app.use((req, res, next) => {
  if (
    req.path === "/" ||
    req.path.startsWith("/dashboard") ||
    req.path.endsWith(".html")
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

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
    req.path.startsWith("/api/dashboard/cliente") ||
    req.path.startsWith("/api/inventario/") ||
    req.path.startsWith("/api/catastro/")
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
      if (out.reason === "plan_restricted") {
        return res.status(403).json({
          ok: false,
          error: "El acceso al Panel Web requiere un Plan Básico o superior. ¡Podés actualizar tu plan desde WhatsApp!",
          code: "PLAN_RESTRICTED",
        });
      }
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
  const plan = String(ses.user?.plan || "").toLowerCase();
  if (plan === "gratis" || !plan) {
    return res.json({ ok: false, error: "plan_restricted" });
  }
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

app.use("/api/catastro", require("./services/api_catastro"));

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

app.get("/dashboard/ia", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "ia.html"));
});

app.get("/dashboard/campanas", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "campanas.html"));
});

app.get("/dashboard/planes", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "public", "planes.html"));
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

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const usuarioIdsRaw = body.usuario_ids;
    const usuarioIdRaw = body.usuario_id;
    const numero = String(body.whatsapp || "").trim();

    const enviarInvitacionResumen = async (usuario) => {
      const destinoWp = destinoWhatsappParaEnvio(usuario);
      let ultimoEnvio = null;
      const out = await iniciarResumen(usuario, {
        enviar: async (texto) => {
          ultimoEnvio = await sendMessage(destinoWp, texto);
        },
      });
      return {
        omitido: Boolean(out?.omitido),
        motivo: out?.motivo,
        mensajeId: ultimoEnvio?.id?._serialized || null,
      };
    };

    if (Array.isArray(usuarioIdsRaw) && usuarioIdsRaw.length > 0) {
      const MAX_LOTE = 40;
      if (usuarioIdsRaw.length > MAX_LOTE) {
        return res.status(400).json({
          ok: false,
          error: `Máximo ${MAX_LOTE} usuario_ids por solicitud`,
        });
      }
      const sleepLote = (ms) => new Promise((r) => setTimeout(r, ms));
      const results = [];
      for (let i = 0; i < usuarioIdsRaw.length; i += 1) {
        const raw = usuarioIdsRaw[i];
        const id = Number.parseInt(String(raw).trim(), 10);
        if (!Number.isFinite(id) || id <= 0) {
          results.push({ usuario_id: raw, ok: false, error: "id inválido" });
        } else {
          try {
            const rU = await query(
              `
              SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real, plan, plan_activo_hasta
              FROM usuarios
              WHERE id = $1 AND activo = true
              LIMIT 1
            `,
              [id]
            );
            const usuario = rU.rows[0];
            if (!usuario) {
              results.push({
                usuario_id: id,
                ok: false,
                error: "no encontrado o inactivo",
              });
            } else {
              const r = await enviarInvitacionResumen(usuario);
              if (r.omitido) {
                results.push({
                  usuario_id: id,
                  ok: false,
                  omitido: true,
                  motivo: r.motivo,
                  error: "onboarding o COMPLETAR PERFIL pendiente",
                });
              } else {
                results.push({ usuario_id: id, ok: true, mensajeId: r.mensajeId });
              }
            }
          } catch (err) {
            results.push({
              usuario_id: id,
              ok: false,
              error: String(err?.message || err),
            });
          }
        }
        if (i < usuarioIdsRaw.length - 1) {
          await sleepLote(2000);
        }
      }
      const algunOk = results.some((x) => x.ok);
      return res.json({
        ok: algunOk,
        modo: "resumen_interactivo_lote",
        detalle:
          "Invitación sí/no por usuario. Revisar results[] si alguno falló.",
        results,
      });
    }

    if (usuarioIdRaw !== undefined && usuarioIdRaw !== null && String(usuarioIdRaw).trim() !== "") {
      const idUnico = Number.parseInt(String(usuarioIdRaw).trim(), 10);
      if (!Number.isFinite(idUnico) || idUnico <= 0) {
        return res.status(400).json({ ok: false, error: "usuario_id inválido" });
      }
      const rU = await query(
        `
        SELECT id, nombre, whatsapp, whatsapp_jid, whatsapp_real, plan, plan_activo_hasta
        FROM usuarios
        WHERE id = $1 AND activo = true
        LIMIT 1
      `,
        [idUnico]
      );
      const usuario = rU.rows[0];
      if (!usuario) {
        return res
          .status(404)
          .json({ ok: false, error: "No existe usuario activo con ese id" });
      }
      const r = await enviarInvitacionResumen(usuario);
      if (r.omitido) {
        return res.status(409).json({
          ok: false,
          omitido: true,
          motivo: r.motivo,
          error:
            "El usuario tiene pendiente el registro o COMPLETAR PERFIL. Terminá ese paso antes de enviar el resumen.",
        });
      }
      return res.json({
        ok: true,
        modo: "resumen_interactivo",
        usuario_id: idUnico,
        detalle:
          "Se envió la invitación al flujo por pasos (sí/no). El resumen completo se guarda al terminar el chat.",
        mensajeId: r.mensajeId,
      });
    }

    if (!numero) {
      return res.status(400).json({
        ok: false,
        error: "Falta body.whatsapp, usuario_id o usuario_ids",
      });
    }

    const usuario = await buscarPorWhatsapp(numero);
    if (!usuario) {
      return res
        .status(404)
        .json({ ok: false, error: "No existe usuario para ese whatsapp" });
    }

    const r = await enviarInvitacionResumen(usuario);
    if (r.omitido) {
      return res.status(409).json({
        ok: false,
        omitido: true,
        motivo: r.motivo,
        error:
          "El usuario tiene pendiente el registro o COMPLETAR PERFIL. Terminá ese paso antes de enviar el resumen.",
      });
    }

    return res.json({
      ok: true,
      modo: "resumen_interactivo",
      detalle:
        "Se envió la invitación al flujo por pasos (sí/no). El resumen completo se guarda al terminar el chat.",
      mensajeId: r.mensajeId,
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

app.get("/api/dashboard/admin/agent-plan", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 40);
    const rows = await getUltimosPlanesAgente(limit);
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, rows });
  } catch (error) {
    console.error("Fallo dashboard admin agent-plan:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/agent-tools", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, tools: agentToolsRegistry.listTools() });
  } catch (error) {
    console.error("Fallo dashboard admin agent-tools:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/agent-runtime", async (req, res) => {
  try {
    const dias = Number(req.query.dias ?? req.query.days ?? 7);
    const data = await getAgentRuntimeAdmin({ dias });
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Fallo dashboard admin agent-runtime:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/agent-env", async (_req, res) => {
  try {
    const data = getAdminEditableEnv();
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, data });
  } catch (error) {
    console.error("Fallo dashboard admin agent-env:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/agent-env", async (req, res) => {
  try {
    const patch = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const result = await postAdminEditableEnv(patch);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Fallo dashboard admin agent-env POST:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/agent-cola", async (_req, res) => {
  try {
    const data = await getAgentColaResumen();
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error("Fallo dashboard admin agent-cola:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/usuarios", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const usuarios = await getUltimosUsuarios(limit);

    // Buscamos todos los delegados/integrantes de campo
    const telefonos = await query(
      `
        SELECT t.id, t.usuario_principal_id, t.whatsapp_autorizado, t.nombre_contacto, t.rol, t.activo, t.aceptado, t.creado_en,
               u.nombre AS owner_nombre, u.whatsapp AS owner_whatsapp
        FROM telefonos_autorizados t
        LEFT JOIN usuarios u ON u.id = t.usuario_principal_id
        ORDER BY t.creado_en DESC
      `
    );

    // Mapeamos los delegados a un formato virtual de usuario
    const virtualUsers = telefonos.rows.map(t => ({
      id: `t_${t.id}`,
      nombre: t.nombre_contacto,
      whatsapp: t.whatsapp_autorizado,
      whatsapp_real: t.whatsapp_autorizado,
      whatsapp_jid: null,
      provincia: "",
      partido: "",
      plan: "gratis",
      activo: t.activo && t.aceptado,
      creado_en: t.creado_en,
      perfil_productivo: t.rol ? `rol:${t.rol}` : "delegado",
      consultas_total: 0,
      tokens_consultas: 0,
      ultima_consulta: null,
      cultivos_activos: 0,
      movimientos_stock_ganadero: 0,
      es_invitado: true,
      aceptado: t.aceptado,
      rol: t.rol,
      usuario_principal_id: t.usuario_principal_id,
      owner_nombre: t.owner_nombre,
    }));

    // Combinamos ambas listas y ordenamos por fecha de creación descendente
    const allUsers = [...usuarios, ...virtualUsers];
    allUsers.sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));

    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, usuarios: allUsers });
  } catch (error) {
    console.error("Fallo dashboard admin usuarios:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/admin/telefonos", async (req, res) => {
  try {
    const result = await query(
      `
        SELECT t.id, t.usuario_principal_id, t.whatsapp_autorizado, t.nombre_contacto, t.rol, t.activo, t.aceptado, t.creado_en,
               u.nombre AS owner_nombre, u.whatsapp AS owner_whatsapp
        FROM telefonos_autorizados t
        LEFT JOIN usuarios u ON u.id = t.usuario_principal_id
        ORDER BY t.creado_en DESC
      `
    );
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, telefonos: result.rows });
  } catch (error) {
    console.error("Fallo dashboard admin telefonos:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});


app.get("/api/dashboard/admin/planes", async (req, res) => {
  try {
    const r = await query(
      `SELECT plan_nombre, precio, limite_audios_semanal, limite_fotos_semanal, limite_consultas_semanal
       FROM planes_config
       ORDER BY precio ASC`
    );
    res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    return res.json({ ok: true, data: r.rows });
  } catch (error) {
    console.error("Fallo api /api/dashboard/admin/planes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/admin/planes/update", async (req, res) => {
  try {
    const { plan_nombre, precio, limite_audios_semanal, limite_fotos_semanal, limite_consultas_semanal } = req.body;
    if (!plan_nombre) {
      return res.status(400).json({ ok: false, error: "plan_nombre es requerido" });
    }
    const r = await query(
      `UPDATE planes_config
       SET precio = $2,
           limite_audios_semanal = $3,
           limite_fotos_semanal = $4,
           limite_consultas_semanal = $5,
           actualizado_en = NOW()
       WHERE plan_nombre = $1
       RETURNING *`,
      [
        plan_nombre,
        Number(precio || 0),
        Number(limite_audios_semanal),
        Number(limite_fotos_semanal),
        Number(limite_consultas_semanal)
      ]
    );
    if (!r.rows[0]) {
      return res.status(404).json({ ok: false, error: "Plan no encontrado" });
    }
    try {
      const { actualizarPrecioCache } = require("./services/planes");
      actualizarPrecioCache(plan_nombre, precio);
    } catch (e) {
      console.error("[index] Error al actualizar caché de precios de planes:", e.message);
    }
    return res.json({ ok: true, data: r.rows[0] });
  } catch (error) {
    console.error("Fallo api /api/dashboard/admin/planes/update:", error.message);
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

app.get("/api/dashboard/admin/outreach-candidatos", async (req, res) => {
  try {
    const diasRaw = req.query.dias;
    const dias = (diasRaw !== undefined && diasRaw !== "") ? Number(diasRaw) : 7;
    const limit = Number(req.query.limit || 100);
    const items = await getOutreachCandidatos({ diasInactividad: dias, limit });
    return res.json({ ok: true, items });
  } catch (error) {
    console.error("Fallo dashboard admin outreach-candidatos:", error.message);
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
    const plan = ["gratis", "basico", "pro", "pro_max"].includes(planReq) ? planReq : "gratis";
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
    const rawId = req.body?.usuarioId;
    const isDelegate = typeof rawId === "string" && rawId.startsWith("t_");
    const delegateId = isDelegate ? Number(rawId.replace("t_", "")) : null;
    const usuarioId = isDelegate ? null : Number(rawId);
    const accion = String(req.body?.accion || "").trim().toLowerCase();
    const planObjetivoRaw = req.body?.planObjetivo;

    if ((!usuarioId && !delegateId) || !accion) {
      return res.status(400).json({ ok: false, error: "Falta usuarioId o accion" });
    }
    if (usuarioId === 1) {
      return res.status(400).json({ ok: false, error: "No se permite modificar usuario del sistema" });
    }

    let usuario = null;

    if (isDelegate) {
      if (accion === "pausar") {
        const r = await query(`UPDATE telefonos_autorizados SET activo = false WHERE id = $1 RETURNING id, nombre_contacto AS nombre, activo`, [delegateId]);
        usuario = r.rows[0] || null;
      } else if (accion === "activar") {
        const r = await query(`UPDATE telefonos_autorizados SET activo = true WHERE id = $1 RETURNING id, nombre_contacto AS nombre, activo`, [delegateId]);
        usuario = r.rows[0] || null;
      } else if (accion === "eliminar") {
        const r = await query(`DELETE FROM telefonos_autorizados WHERE id = $1 RETURNING id, nombre_contacto AS nombre`, [delegateId]);
        usuario = r.rows[0] || { id: delegateId, nombre: "Delegado Eliminado" };
      } else {
        return res.status(400).json({ ok: false, error: "Acción no soportada para integrante de equipo" });
      }
    } else {
      if (accion === "pausar") {
        usuario = await setActivoUsuario(usuarioId, false);
      } else if (accion === "activar") {
        usuario = await setActivoUsuario(usuarioId, true);
      } else if (accion === "eliminar") {
        usuario = await eliminarUsuarioSoft(usuarioId);
      } else if (accion === "cambiar_plan") {
        const planObjetivo = String(planObjetivoRaw || "").trim().toLowerCase();
        if (!["gratis", "basico", "pro", "pro_max"].includes(planObjetivo)) {
          return res.status(400).json({ ok: false, error: "planObjetivo inválido. Usar: gratis|basico|pro|pro_max" });
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
    }

    if (!usuario) {
      return res.status(404).json({ ok: false, error: "Usuario o delegado no encontrado" });
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
    if (!["basico", "pro", "pro_max", "gratis"].includes(planObjetivo)) {
      return res.status(400).json({
        ok: false,
        error: "planObjetivo inválido. Usar: basico | pro | pro_max | gratis",
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

app.post("/api/dashboard/cliente/consulta", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }
    const { consulta } = req.body;
    if (!consulta || !consulta.trim()) {
      return res.status(400).json({ ok: false, error: "Consulta vacía" });
    }

    // 1. Obtener datos del usuario
    const usuarioResult = await query(
      `
        SELECT id, nombre, email, whatsapp, provincia, partido, plan, activo, lat, lng
        FROM usuarios
        WHERE id = $1
        LIMIT 1
      `,
      [usuarioId]
    );
    const usuario = usuarioResult.rows[0];
    if (!usuario) {
      return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }

    // Formateador de fecha simple YYYY-MM-DD
    const formatToISODate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 10);
    };

    // 2. Obtener precios de hoy (todos los precios de la fecha máxima)
    const maxFechaPreciosRes = await query("SELECT MAX(fecha) AS fecha FROM precios");
    const maxFechaPrecios = maxFechaPreciosRes.rows[0]?.fecha;
    let preciosItems = [];
    if (maxFechaPrecios) {
      const preciosRes = await query(
        "SELECT cultivo, mercado, precio, moneda FROM precios WHERE fecha = $1",
        [maxFechaPrecios]
      );
      preciosItems = preciosRes.rows;
    }
    const precios = { fecha: formatToISODate(maxFechaPrecios), items: preciosItems };

    // 3. Obtener tipo de cambio de hoy
    const maxFechaTipoCambioRes = await query("SELECT MAX(fecha) AS fecha FROM tipo_cambio");
    const maxFechaTipoCambio = maxFechaTipoCambioRes.rows[0]?.fecha;
    let tipoCambioItems = [];
    if (maxFechaTipoCambio) {
      const tipoCambioRes = await query(
        "SELECT tipo, valor FROM tipo_cambio WHERE fecha = $1",
        [maxFechaTipoCambio]
      );
      tipoCambioItems = tipoCambioRes.rows;
    }
    const tipoCambio = { fecha: formatToISODate(maxFechaTipoCambio), items: tipoCambioItems };

    // 4. Obtener clima de su zona si tiene coordenadas
    let climaItems = [];
    if (usuario.lat != null && usuario.lng != null) {
      try {
        const { obtenerClimaFresco } = require("./templates/base");
        const cl = await obtenerClimaFresco(usuario.lat, usuario.lng);
        climaItems = cl?.items || [];
      } catch (eClima) {
        console.error("Error al obtener clima para consulta chat:", eClima.message);
      }
    }

    // 5. Llamar a construirRespuestaInteligenteGeneral
    const { construirRespuestaInteligenteGeneral } = require("./services/consultas/legacy_helpers");
    const respuesta = await construirRespuestaInteligenteGeneral({
      pregunta: consulta.trim(),
      usuario,
      precios,
      tipoCambio,
      clima: climaItems,
      nivel: "INTERMEDIO"
    });

    // 6. Guardar la consulta en historial_consultas
    try {
      const { guardarConsulta } = require("./models/consulta");
      await guardarConsulta({
        usuarioId: usuario.id,
        whatsapp: usuario.whatsapp,
        pregunta: consulta.trim(),
        respuesta: respuesta,
        tokensUsados: null
      });
    } catch (eSave) {
      console.error("Error al guardar consulta en historial desde panel web:", eSave.message);
    }

    return res.json({ ok: true, respuesta });
  } catch (error) {
    console.error("Error en POST /api/dashboard/cliente/consulta:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/cliente/clima", async (req, res) => {
  try {
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "lat y lng obligatorios" });
    }
    const { obtenerClimaFresco } = require("./templates/base");
    const cl = await obtenerClimaFresco(lat, lng);
    return res.json({ ok: true, clima: cl?.items || [] });
  } catch (error) {
    console.error("Fallo GET /api/dashboard/cliente/clima:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/cliente/clima/horas", async (req, res) => {
  try {
    const lat = req.query.lat ? Number(req.query.lat) : null;
    const lng = req.query.lng ? Number(req.query.lng) : null;
    if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ ok: false, error: "lat y lng obligatorios" });
    }
    const axios = require("axios");
    const response = await axios.get("https://api.open-meteo.com/v1/forecast", {
      params: {
        latitude: lat,
        longitude: lng,
        hourly: "temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation_probability,precipitation",
        timezone: "America/Argentina/Buenos_Aires",
        forecast_days: 2,
        windspeed_unit: "kmh"
      },
      timeout: 10000
    });
    
    const hourly = response.data?.hourly;
    if (!hourly || !Array.isArray(hourly.time)) {
      return res.json({ ok: true, horas: [] });
    }
    
    const horas = hourly.time.map((time, i) => {
      const temp = hourly.temperature_2m?.[i];
      const hum = hourly.relative_humidity_2m?.[i];
      const wind = hourly.wind_speed_10m?.[i];
      const precipProb = hourly.precipitation_probability?.[i];
      const precip = hourly.precipitation?.[i];
      
      // Determine spraying condition
      let pulverizacion = "optimo"; // green
      const detallesPulv = [];
      
      if (wind >= 15) {
        pulverizacion = "no_recomendado"; // red
        detallesPulv.push("Viento excesivo (>=15 km/h)");
      } else if (wind > 10) {
        pulverizacion = "moderado"; // yellow
        detallesPulv.push("Viento moderado (10-15 km/h)");
      }
      
      if (hum < 40) {
        pulverizacion = "no_recomendado";
        detallesPulv.push("Humedad baja (<40%)");
      } else if (hum > 80) {
        pulverizacion = "moderado";
        detallesPulv.push("Humedad alta (>80%)");
      }
      
      if (temp >= 30) {
        pulverizacion = "no_recomendado";
        detallesPulv.push("Temperatura alta (>=30°C)");
      } else if (temp < 10) {
        pulverizacion = "moderado";
        detallesPulv.push("Temperatura baja (<10°C)");
      }
      
      if (precipProb > 30 || precip > 0) {
        pulverizacion = "no_recomendado";
        detallesPulv.push("Probabilidad de lluvia o precipitación");
      }
      
      return {
        fecha: time,
        temperatura: temp,
        humedad: hum,
        viento: wind,
        probabilidad_lluvia: precipProb,
        precipitacion: precip,
        pulverizacion,
        motivo_pulverizacion: detallesPulv.join(", ") || "Condiciones óptimas"
      };
    });
    
    return res.json({ ok: true, horas });
  } catch (error) {
    console.error("Fallo GET /api/dashboard/cliente/clima/horas:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/cliente/calendario", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }

    const [
      manualRes,
      siembraRes,
      pasturaRes,
      animalRes,
      telemetriaRes,
      laborManualRes
    ] = await Promise.all([
      // 1. Manuales
      query(
        `SELECT e.id, e.titulo, e.descripcion, e.fecha_inicio, e.fecha_fin, e.categoria, e.lote_id, l.nombre AS lote_nombre, 'manual' AS origen
         FROM eventos_calendario e
         LEFT JOIN lotes l ON l.id = e.lote_id
         WHERE e.usuario_id = $1`,
        [usuarioId]
      ),
      // 2. Siembras
      query(
        `SELECT id, 'Siembra de ' || cultivo || ' - Lote ' || nombre AS titulo, 'Variedad: ' || COALESCE(variedad, 'N/C') || '. Densidad: ' || COALESCE(densidad::text, 'N/C') AS descripcion, fecha_siembra AS fecha_inicio, fecha_siembra AS fecha_fin, 'agricultura' AS categoria, id AS lote_id, nombre AS lote_nombre, 'siembra' AS origen
         FROM lotes
         WHERE usuario_id = $1 AND fecha_siembra IS NOT NULL`,
        [usuarioId]
      ),
      // 3. Pasturas
      query(
        `SELECT id, 
                CASE 
                  WHEN tipo = 'ingreso_animales' THEN 'Ingreso a pastoreo - Lote ' || COALESCE(lote_nombre, '')
                  WHEN tipo = 'retiro_animales' THEN 'Retiro de animales - Lote ' || COALESCE(lote_nombre, '')
                  WHEN tipo = 'inicio_descanso' THEN 'Inicio de descanso - Lote ' || COALESCE(lote_nombre, '')
                  WHEN tipo = 'rebrote' THEN 'Rebrote registrado - Lote ' || COALESCE(lote_nombre, '')
                  WHEN tipo = 'pesaje_pasto' THEN 'Pesaje de pasto - Lote ' || COALESCE(lote_nombre, '')
                  ELSE 'Pastura - Lote ' || COALESCE(lote_nombre, '')
                END AS titulo,
                COALESCE(observacion, '') || CASE WHEN cabezas IS NOT NULL THEN '. Cabezas: ' || cabezas::text ELSE '' END AS descripcion,
                fecha_evento AS fecha_inicio,
                fecha_evento AS fecha_fin,
                'ganaderia' AS categoria,
                lote_id,
                lote_nombre,
                tipo AS tipo_evento,
                'pastura' AS origen
         FROM eventos_pastura
         WHERE usuario_id = $1`,
        [usuarioId]
      ),
      // 4. Animales (veterinaria)
      query(
        `SELECT e.id,
                UPPER(e.tipo_evento) || ' - Animal Caravana: ' || a.caravana AS titulo,
                'Detalle: ' || COALESCE(e.valor_texto, '') || 
                CASE WHEN e.valor_numerico IS NOT NULL THEN ' (Valor: ' || e.valor_numerico::text || ')' ELSE '' END || 
                '. Obs: ' || COALESCE(e.observaciones, '') AS descripcion,
                e.fecha AS fecha_inicio,
                e.fecha AS fecha_fin,
                'ganaderia' AS categoria,
                a.lote_id,
                l.nombre AS lote_nombre,
                'animal' AS origen
         FROM animales_eventos e
         JOIN animales_individuales a ON a.id = e.animal_id
         LEFT JOIN lotes l ON l.id = a.lote_id
         WHERE e.usuario_id = $1`,
        [usuarioId]
      ),
      // 5. Telemetria labores
      query(
        `SELECT t.id,
                'Labor de ' || UPPER(t.tipo_labor) || ' - Lote ' || COALESCE(l.nombre, '') AS titulo,
                'Insumo: ' || COALESCE(t.insumo_nombre, 'N/C') || '. Dosis promedio: ' || COALESCE(t.dosis_promedio::text, 'N/C') || ' ' || COALESCE(t.unidad_dosis, '') || '. Maquinaria: ' || COALESCE(t.marca_maquinaria, '') || ' ' || COALESCE(t.modelo_maquinaria, '') AS descripcion,
                t.fecha_inicio,
                t.fecha_fin,
                'telemetria' AS categoria,
                t.lote_id,
                l.nombre AS lote_nombre,
                'telemetria' AS origen
         FROM telemetria_labores t
         LEFT JOIN lotes l ON l.id = t.lote_id
         WHERE t.usuario_id = $1`,
        [usuarioId]
      ),
      // 6. Labor manual (WhatsApp machinery)
      query(
        `SELECT r.id,
                'Labor de ' || UPPER(r.tipo_labor) || ' - Lote ' || COALESCE(r.lote_nombre, '') AS titulo,
                'Insumo: ' || COALESCE(r.producto_insumo, 'N/C') || '. Dosis promedio: ' || COALESCE(r.dosis_promedio::text, 'N/C') || '. Hectáreas reales: ' || COALESCE(r.hectareas_reales::text, 'N/C') AS descripcion,
                r.creado_en AS fecha_inicio,
                r.creado_en AS fecha_fin,
                'telemetria' AS categoria,
                NULL::int AS lote_id,
                r.lote_nombre,
                'labor_manual' AS origen
         FROM registro_labores_maquinaria r
         WHERE r.usuario_id = $1`,
        [usuarioId]
      )
    ]);

    const items = [];

    // Add manual events
    manualRes.rows.forEach(r => {
      items.push({
        id: `manual_${r.id}`,
        dbId: r.id,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        categoria: r.categoria,
        lote_id: r.lote_id,
        lote_nombre: r.lote_nombre,
        origen: r.origen
      });
    });

    // Add sowing events
    siembraRes.rows.forEach(r => {
      items.push({
        id: `siembra_${r.id}`,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        categoria: r.categoria,
        lote_id: r.lote_id,
        lote_nombre: r.lote_nombre,
        origen: r.origen
      });
    });

    // Add pasture events & projected rest release
    pasturaRes.rows.forEach(r => {
      items.push({
        id: `pastura_${r.id}`,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        categoria: r.categoria,
        lote_id: r.lote_id,
        lote_nombre: r.lote_nombre,
        origen: r.origen
      });

      if (r.tipo_evento === 'retiro_animales' || r.tipo_evento === 'inicio_descanso') {
        const fechaBase = new Date(r.fecha_inicio);
        const fechaSugerida = new Date(fechaBase.getTime() + (35 * 24 * 60 * 60 * 1000));
        items.push({
          id: `pastura_proyeccion_${r.id}`,
          titulo: `Liberación sugerida - Lote ${r.lote_nombre || ''}`,
          descripcion: `35 días de descanso sugeridos completados desde el ${fechaBase.toLocaleDateString('es-AR')}`,
          fecha_inicio: fechaSugerida.toISOString(),
          fecha_fin: fechaSugerida.toISOString(),
          categoria: 'clima', // Clima/Descanso color dot
          lote_id: r.lote_id,
          lote_nombre: r.lote_nombre,
          origen: 'pastura_descanso_proyeccion'
        });
      }
    });

    // Add animal events
    animalRes.rows.forEach(r => {
      items.push({
        id: `animal_${r.id}`,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        categoria: r.categoria,
        lote_id: r.lote_id,
        lote_nombre: r.lote_nombre,
        origen: r.origen
      });
    });

    // Add telemetria events
    telemetriaRes.rows.forEach(r => {
      items.push({
        id: `telemetria_${r.id}`,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        categoria: r.categoria,
        lote_id: r.lote_id,
        lote_nombre: r.lote_nombre,
        origen: r.origen
      });
    });

    // Add manual labor events
    laborManualRes.rows.forEach(r => {
      items.push({
        id: `labor_manual_${r.id}`,
        titulo: r.titulo,
        descripcion: r.descripcion,
        fecha_inicio: r.fecha_inicio,
        fecha_fin: r.fecha_fin,
        categoria: r.categoria,
        lote_id: r.lote_id,
        lote_nombre: r.lote_nombre,
        origen: r.origen
      });
    });

    return res.json({ ok: true, items });
  } catch (error) {
    console.error("Fallo GET /api/dashboard/cliente/calendario:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/cliente/calendario", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }
    const { titulo, descripcion, fecha_inicio, fecha_fin, categoria, lote_id } = req.body;
    if (!titulo) {
      return res.status(400).json({ ok: false, error: "Título obligatorio" });
    }
    if (!fecha_inicio) {
      return res.status(400).json({ ok: false, error: "Fecha de inicio obligatoria" });
    }

    const resInsert = await query(
      `INSERT INTO eventos_calendario (usuario_id, titulo, descripcion, fecha_inicio, fecha_fin, categoria, lote_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [usuarioId, titulo, descripcion || null, fecha_inicio, fecha_fin || null, categoria || 'admin', lote_id || null]
    );

    return res.json({ ok: true, id: resInsert.rows[0].id });
  } catch (error) {
    console.error("Fallo POST /api/dashboard/cliente/calendario:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/dashboard/cliente/calendario/:id", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }
    const id = req.params.id;
    const resDelete = await query(
      `DELETE FROM eventos_calendario WHERE id = $1 AND usuario_id = $2`,
      [id, usuarioId]
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("Fallo DELETE /api/dashboard/cliente/calendario/:id:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/cliente/telemetria/conectar", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    if (!usuarioId) return res.status(401).json({ ok: false, error: "No autorizado" });
    
    const { proveedor } = req.body;
    if (!proveedor) return res.status(400).json({ ok: false, error: "Falta el proveedor" });
    
    const leafUserId = `leaf_usr_${proveedor}_${usuarioId}_${Math.random().toString(36).substring(2, 7)}`;
    
    await query(
      `
        INSERT INTO telemetria_conexiones (usuario_id, proveedor, leaf_user_id, estado, actualizado_en)
        VALUES ($1, $2, $3, 'activo', NOW())
        ON CONFLICT (usuario_id, proveedor) 
        DO UPDATE SET estado = 'activo', leaf_user_id = EXCLUDED.leaf_user_id, actualizado_en = NOW()
      `,
      [usuarioId, proveedor, leafUserId]
    );

    let loteId = null;
    let loteHectareas = 100;
    const rLotes = await query("SELECT id, nombre, hectareas FROM lotes WHERE usuario_id = $1 LIMIT 1", [usuarioId]);
    if (rLotes.rows.length > 0) {
      loteId = rLotes.rows[0].id;
      loteHectareas = Number(rLotes.rows[0].hectareas) || 100;
    } else {
      const rNewLote = await query(
        "INSERT INTO lotes (usuario_id, nombre, hectareas, cultivo) VALUES ($1, 'Lote Norte', 120, 'Maíz') RETURNING id, hectareas",
        [usuarioId]
      );
      loteId = rNewLote.rows[0].id;
      loteHectareas = 120;
    }

    const marca = proveedor === 'john_deere' ? 'John Deere' : proveedor === 'climate_fieldview' ? 'Climate FieldView' : 'Case IH';
    await query("DELETE FROM telemetria_labores WHERE usuario_id = $1 AND marca_maquinaria = $2", [
      usuarioId,
      marca
    ]);

    if (proveedor === 'john_deere') {
      await query(
        `
          INSERT INTO telemetria_labores 
            (usuario_id, lote_id, tipo_labor, fecha_inicio, fecha_fin, hectareas_reales, velocidad_promedio, insumo_nombre, dosis_promedio, unidad_dosis, marca_maquinaria, modelo_maquinaria, externo_job_id)
          VALUES 
            ($1, $2, 'siembra', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '12 days', $3 * 0.98, 8.5, 'DK 72-10 Híbrido Maíz', 78000, 'semillas/ha', 'John Deere', 'DB88 24 Filas Gen 4', $4)
        `,
        [usuarioId, loteId, loteHectareas, `jd_job_seeding_${usuarioId}`]
      );
      await query(
        `
          INSERT INTO telemetria_labores 
            (usuario_id, lote_id, tipo_labor, fecha_inicio, fecha_fin, hectareas_reales, velocidad_promedio, insumo_nombre, dosis_promedio, unidad_dosis, marca_maquinaria, modelo_maquinaria, externo_job_id)
          VALUES 
            ($1, $2, 'cosecha', CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE, $3 * 0.99, 5.8, 'Maíz Grano', 9.4, 'tn/ha', 'John Deere', 'S780 Combine & Draper 45ft', $4)
        `,
        [usuarioId, loteId, loteHectareas, `jd_job_harvest_${usuarioId}`]
      );
      
      await query("DELETE FROM telemetria_lote_zonas WHERE lote_id = $1", [loteId]);
      await query(
        `
          INSERT INTO telemetria_lote_zonas (lote_id, zona_etiqueta, porcentaje_area, hectareas_zona, rinde_historico)
          VALUES 
            ($1, 'Alta Productividad', 0.4500, $2 * 0.45, 11.20),
            ($1, 'Media Productividad', 0.3500, $2 * 0.35, 8.90),
            ($1, 'Baja Productividad (Loma)', 0.2000, $2 * 0.20, 6.10)
        `,
        [loteId, loteHectareas]
      );
    } else if (proveedor === 'climate_fieldview') {
      await query(
        `
          INSERT INTO telemetria_labores 
            (usuario_id, lote_id, tipo_labor, fecha_inicio, fecha_fin, hectareas_reales, velocidad_promedio, insumo_nombre, dosis_promedio, unidad_dosis, marca_maquinaria, modelo_maquinaria, externo_job_id)
          VALUES 
            ($1, $2, 'pulverizacion', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '9 days', $3, 16.2, 'Glifosato + Atrazina Premium', 2.5, 'litros/ha', 'Climate FieldView', 'Pla Map 3 3600', $4)
        `,
        [usuarioId, loteId, loteHectareas, `cfv_job_spray_${usuarioId}`]
      );
    } else if (proveedor === 'case_ih') {
      await query(
        `
          INSERT INTO telemetria_labores 
            (usuario_id, lote_id, tipo_labor, fecha_inicio, fecha_fin, hectareas_reales, velocidad_promedio, insumo_nombre, dosis_promedio, unidad_dosis, marca_maquinaria, modelo_maquinaria, externo_job_id)
          VALUES 
            ($1, $2, 'fertilizacion', CURRENT_DATE - INTERVAL '8 days', CURRENT_DATE - INTERVAL '7 days', $3 * 1.01, 12.0, 'Urea Granulada 46-0-0', 145.0, 'kg/ha', 'Case IH', 'Patriot 350 Variable Rate', $4)
        `,
        [usuarioId, loteId, loteHectareas, `case_job_fert_${usuarioId}`]
      );
    }

    return res.json({ ok: true, message: `Proveedor ${proveedor} conectado con éxito y datos de telemetría simulados.` });
  } catch (error) {
    console.error("Error al conectar telemetría:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/cliente/telemetria/desconectar", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    if (!usuarioId) return res.status(401).json({ ok: false, error: "No autorizado" });
    
    const { proveedor } = req.body;
    if (!proveedor) return res.status(400).json({ ok: false, error: "Falta el proveedor" });

    await query(
      `
        UPDATE telemetria_conexiones 
        SET estado = 'desconectado', actualizado_en = NOW()
        WHERE usuario_id = $1 AND proveedor = $2
      `,
      [usuarioId, proveedor]
    );

    const marca = proveedor === 'john_deere' ? 'John Deere' : proveedor === 'climate_fieldview' ? 'Climate FieldView' : 'Case IH';
    await query(
      `
        DELETE FROM telemetria_labores
        WHERE usuario_id = $1 AND marca_maquinaria = $2
      `,
      [usuarioId, marca]
    );

    return res.json({ ok: true, message: `Proveedor ${proveedor} desconectado y sus labores eliminadas.` });
  } catch (error) {
    console.error("Error al desconectar telemetría:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/dashboard/cliente/telefonos", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const result = await query(
      `
        SELECT id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado, creado_en
        FROM telefonos_autorizados
        WHERE usuario_principal_id = $1
        ORDER BY creado_en DESC
      `,
      [usuarioId]
    );
    return res.json({ ok: true, telefonos: result.rows });
  } catch (error) {
    console.error("Fallo listar telefonos delegados:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/cliente/telefonos", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const { whatsapp_autorizado, nombre_contacto, rol } = req.body;

    const whatsappNorm = String(whatsapp_autorizado || "").replace(/\D/g, "");
    if (!whatsappNorm || whatsappNorm.length < 8) {
      return res.status(400).json({
        ok: false,
        error: "Número de WhatsApp inválido. Ingresá solo dígitos (ej. 549...).",
      });
    }

    if (!nombre_contacto || !String(nombre_contacto).trim()) {
      return res.status(400).json({ ok: false, error: "El nombre de contacto es obligatorio." });
    }

    const rolNorm = String(rol || "").trim().toLowerCase().slice(0, 20) || "operario";

    const { variantesTelefono } = require("./services/cliente_auth");
    const variantes = variantesTelefono(whatsappNorm);

    // Validar que el número no esté registrado como usuario principal de pago
    const checkUser = await query(
      `
        SELECT id FROM usuarios 
        WHERE (regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = ANY($1::text[])
           OR regexp_replace(COALESCE(whatsapp_real, ''), '\\D', '', 'g') = ANY($1::text[]))
          AND plan <> 'gratis' AND plan IS NOT NULL
        LIMIT 1
      `,
      [variantes]
    );
    if (checkUser.rows.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "Este número ya está registrado como una cuenta principal premium en el sistema.",
      });
    }

    // Validar plan de suscripción del dueño del campo y sus límites de integrantes
    const ownerUser = await query(`SELECT plan, plan_activo_hasta FROM usuarios WHERE id = $1`, [usuarioId]);
    const planEfectivo = require("./services/planes").resolverPlanEfectivo({
      plan: ownerUser.rows[0]?.plan || "gratis",
      planActivoHasta: ownerUser.rows[0]?.plan_activo_hasta
    });

    const LIMITES_MIEMBROS = {
      gratis: 0,
      basico: 3,
      pro: 6,
      pro_max: 9999
    };
    const limiteMax = LIMITES_MIEMBROS[planEfectivo] || 0;

    if (limiteMax === 0) {
      return res.status(403).json({
        ok: false,
        error: "Para poder agregar integrantes de equipo de campo, necesitás subir a un plan superior (Básico, Pro o Pro Max)."
      });
    }

    // Contar cuántos integrantes activos tiene actualmente el dueño
    const countActive = await query(
      `SELECT COUNT(*) FROM telefonos_autorizados WHERE usuario_principal_id = $1 AND activo = true`,
      [usuarioId]
    );
    const actuales = parseInt(countActive.rows[0].count, 10);

    // Upsert o insertar el número autorizado
    const checkExist = await query(
      `
        SELECT id, activo FROM telefonos_autorizados 
        WHERE regexp_replace(COALESCE(whatsapp_autorizado, ''), '\\D', '', 'g') = ANY($1::text[])
      `,
      [variantes]
    );

    const isNew = checkExist.rows.length === 0 || !checkExist.rows[0].activo;

    if (isNew && actuales >= limiteMax) {
      return res.status(403).json({
        ok: false,
        error: `Alcanzaste el límite de integrantes permitido para tu Plan ${planEfectivo.toUpperCase()} (máximo: ${limiteMax}). Subí de plan para agregar más.`
      });
    }

    let result;
    if (checkExist.rows.length > 0) {
      result = await query(
        `
          UPDATE telefonos_autorizados 
          SET usuario_principal_id = $1, nombre_contacto = $2, rol = $3, activo = true, aceptado = false, whatsapp_autorizado = $4
          WHERE id = $5
          RETURNING id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado, creado_en
        `,
        [usuarioId, String(nombre_contacto).trim(), rolNorm, whatsappNorm, checkExist.rows[0].id]
      );
    } else {
      result = await query(
        `
          INSERT INTO telefonos_autorizados (usuario_principal_id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado)
          VALUES ($1, $2, $3, $4, true, false)
          RETURNING id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado, creado_en
        `,
        [usuarioId, whatsappNorm, String(nombre_contacto).trim(), rolNorm]
      );
    }

    // Enviar mensaje de invitación por WhatsApp al operario
    try {
      const { sendMessage } = require("./config/whatsapp");
      const nombrePrincipal = req.clienteSession?.user?.nombre;
      const nombreNorm = String(nombre_contacto).trim();

      // Verificar si ya es un usuario principal en el sistema
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

      let msgInvitacion;
      if (yaEsUsuario) {
        msgInvitacion = `¡Hola *${nombreNorm}*! 🌾\n\n` +
          `*${nombrePrincipal || "Un administrador"}* te ha invitado a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rolNorm.toUpperCase()}*.\n\n` +
          `⚠️ *AVISO IMPORTANTE:* Detectamos que ya tenés una cuenta individual registrada en el sistema. Al aceptar formar parte de este equipo, *dejarás de interactuar con tu perfil personal* y todos tus registros futuros (gastos, siembras, hacienda) *se guardarán directamente en el establecimiento de ${nombrePrincipal || "quien te invitó"}*.\n\n` +
          `Para aceptar unirte al equipo de ${nombrePrincipal || "tu administrador"} como ${rolNorm.toUpperCase()}, respondé con la palabra *SI*.\n\n` +
          `Si preferís mantener tu cuenta individual independiente y rechazar esta delegación, respondé *NO*.`;
      } else {
        msgInvitacion = `¡Hola *${nombreNorm}*! 🌾\n\n` +
          `*${nombrePrincipal || "Un administrador"}* te ha invitado a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rolNorm.toUpperCase()}*.\n\n` +
          `Tu cuenta operará bajo los límites del **Plan Gratis** de AgroHabilis (con límite de 25 consultas semanales, 4 audios y hasta 2 fotos por semana).\n\n` +
          `Para aceptar esta invitación y poder registrar datos o consultar al asistente desde tu WhatsApp, respondé con la palabra *SI*.\n\n` +
          `Si querés rechazar la invitación, respondé *NO*.`;
      }

      await sendMessage(whatsappNorm, msgInvitacion);
    } catch (errWp) {
      console.error("No se pudo enviar invitacion por WhatsApp al delegado:", errWp.message);
    }

    return res.json({ ok: true, telefono: result.rows[0] });
  } catch (error) {
    console.error("Fallo agregar telefono delegado:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/dashboard/cliente/telefonos/:id", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await query(
      `
        DELETE FROM telefonos_autorizados 
        WHERE id = $1 AND usuario_principal_id = $2
        RETURNING id
      `,
      [id, usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Teléfono no encontrado o no pertenece a tu cuenta." });
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("Fallo eliminar telefono delegado:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post("/api/dashboard/cliente/telefonos/:id/reenviar", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ ok: false, error: "ID inválido" });
    }

    const result = await query(
      `
        SELECT id, whatsapp_autorizado, nombre_contacto, rol, activo, aceptado
        FROM telefonos_autorizados
        WHERE id = $1 AND usuario_principal_id = $2
      `,
      [id, usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Integrante no encontrado o no pertenece a tu cuenta." });
    }

    const t = result.rows[0];
    if (t.aceptado) {
      return res.status(400).json({ ok: false, error: "Este integrante ya aceptó la invitación." });
    }

    const { sendMessage } = require("./config/whatsapp");
    const { variantesTelefono } = require("./services/cliente_auth");
    const nombrePrincipal = req.clienteSession?.user?.nombre;
    const nombreNorm = t.nombre_contacto;
    const whatsappNorm = t.whatsapp_autorizado;
    const rolNorm = t.rol;

    const variantes = variantesTelefono(whatsappNorm);
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

    let msgInvitacion;
    if (yaEsUsuario) {
      msgInvitacion = `¡Hola *${nombreNorm}*! 🌾\n\n` +
        `*${nombrePrincipal || "Un administrador"}* te ha vuelto a invitar a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rolNorm.toUpperCase()}*.\n\n` +
        `⚠️ *AVISO IMPORTANTE:* Detectamos que ya tenés una cuenta individual registrada en el sistema. Al aceptar formar parte de este equipo, *dejarás de interactuar con tu perfil personal* y todos tus registros futuros (gastos, siembras, hacienda) *se guardarán directamente en el establecimiento de ${nombrePrincipal || "quien te invitó"}*.\n\n` +
        `Para aceptar unirte al equipo de ${nombrePrincipal || "tu administrador"} como ${rolNorm.toUpperCase()}, respondé con la palabra *SI*.\n\n` +
        `Si preferís mantener tu cuenta individual independiente y rechazar esta delegación, respondé *NO*.`;
    } else {
      msgInvitacion = `¡Hola *${nombreNorm}*! 🌾\n\n` +
        `*${nombrePrincipal || "Un administrador"}* te ha vuelto a invitar a formar parte de su equipo de campo en *AgroHabilis* con el rol de *${rolNorm.toUpperCase()}*.\n\n` +
        `Tu cuenta operará bajo los límites del **Plan Gratis** de AgroHabilis (con límite de 25 consultas semanales, 4 audios y hasta 2 fotos por semana).\n\n` +
        `Para aceptar esta invitación y poder registrar datos o consultar al asistente desde tu WhatsApp, respondé con la palabra *SI*.\n\n` +
        `Si querés rechazar la invitación, respondé *NO*.`;
    }

    await sendMessage(whatsappNorm, msgInvitacion);
    return res.json({ ok: true, message: "Invitación re-enviada con éxito." });
  } catch (error) {
    console.error("Fallo re-enviar invitacion delegado:", error.message);
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
    const cliente = req.body?.cliente != null ? String(req.body.cliente).trim() : null;
    const firma = req.body?.firma != null ? String(req.body.firma).trim() : null;
    const provincia = req.body?.provincia != null ? String(req.body.provincia).trim() : null;
    const partido = req.body?.partido != null ? String(req.body.partido).trim() : null;
    const tipo = req.body?.tipo != null ? String(req.body.tipo).trim() : 'lote';
    const lat = req.body?.lat != null && req.body?.lat !== "" ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null && req.body?.lng !== "" ? Number(req.body.lng) : null;

    const lote = await invCrearLote({
      usuarioId,
      nombre,
      hectareas: Number.isFinite(hectareas) ? hectareas : null,
      cultivo: cultivo || null,
      arrendado,
      cliente: cliente || null,
      firma: firma || null,
      provincia: provincia || null,
      partido: partido || null,
      tipo: tipo || 'lote',
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    });
    return res.json({ ok: true, lote });
  } catch (error) {
    console.error("Fallo POST /api/inventario/lotes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/inventario/lotes/:id", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "ID inválido" });

    const nombre = String(req.body?.nombre || "").trim();
    if (!nombre) return res.status(400).json({ ok: false, error: "nombre obligatorio" });

    const hectareas =
      req.body?.hectareas === undefined || req.body?.hectareas === "" ? null : Number(req.body.hectareas);
    const cultivo = req.body?.cultivo != null ? String(req.body.cultivo).trim() : null;
    const arrendado = Boolean(req.body?.arrendado);
    const cliente = req.body?.cliente != null ? String(req.body.cliente).trim() : null;
    const firma = req.body?.firma != null ? String(req.body.firma).trim() : null;
    const provincia = req.body?.provincia != null ? String(req.body.provincia).trim() : null;
    const partido = req.body?.partido != null ? String(req.body.partido).trim() : null;
    const tipo = req.body?.tipo != null ? String(req.body.tipo).trim() : 'lote';
    const lat = req.body?.lat != null && req.body?.lat !== "" ? Number(req.body.lat) : null;
    const lng = req.body?.lng != null && req.body?.lng !== "" ? Number(req.body.lng) : null;

    const resUpdate = await query(
      `
        UPDATE lotes
        SET nombre = $1, hectareas = $2, cultivo = $3, arrendado = $4, cliente = $5, firma = $6, provincia = $7, partido = $8, tipo = $9, lat = $10, lng = $11
        WHERE id = $12 AND usuario_id = $13
        RETURNING *
      `,
      [
        nombre,
        Number.isFinite(hectareas) ? hectareas : null,
        cultivo || null,
        arrendado,
        cliente || null,
        firma || null,
        provincia || null,
        partido || null,
        tipo || 'lote',
        Number.isFinite(lat) ? lat : null,
        Number.isFinite(lng) ? lng : null,
        id,
        usuarioId
      ]
    );

    if (resUpdate.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Lote no encontrado o no pertenece a tu cuenta." });
    }

    return res.json({ ok: true, lote: resUpdate.rows[0] });
  } catch (error) {
    console.error("Fallo PUT /api/inventario/lotes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/inventario/lotes/:id", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "ID inválido" });

    const result = await query(
      `DELETE FROM lotes WHERE id = $1 AND usuario_id = $2 RETURNING id`,
      [id, usuarioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Lote no encontrado o no pertenece a tu cuenta." });
    }

    return res.json({ ok: true, message: "Lote eliminado con éxito." });
  } catch (error) {
    console.error("Fallo DELETE /api/inventario/lotes:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/inventario/firmas/renombrar", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const oldName = String(req.body?.oldName || "").trim();
    const newName = String(req.body?.newName || "").trim();

    if (!oldName || !newName) {
      return res.status(400).json({ ok: false, error: "oldName y newName son obligatorios" });
    }

    await query(
      `UPDATE lotes SET firma = $1 WHERE usuario_id = $2 AND (firma = $3 OR (firma IS NULL AND $3 = ''))`,
      [newName, usuarioId, oldName]
    );

    return res.json({ ok: true, message: "Firmas renombradas con éxito." });
  } catch (error) {
    console.error("Fallo renombrar firmas:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/inventario/firmas/:name", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const name = String(req.params.name || "").trim();

    await query(
      `UPDATE lotes SET firma = NULL WHERE usuario_id = $1 AND (firma = $2 OR (firma IS NULL AND $2 = ''))`,
      [usuarioId, name]
    );

    return res.json({ ok: true, message: "Firma eliminada de los lotes." });
  } catch (error) {
    console.error("Fallo eliminar firma:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.put("/api/inventario/campos/renombrar", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const oldName = String(req.body?.oldName || "").trim();
    const newName = String(req.body?.newName || "").trim();

    if (!oldName || !newName) {
      return res.status(400).json({ ok: false, error: "oldName y newName son obligatorios" });
    }

    await query(
      `UPDATE lotes SET cliente = $1 WHERE usuario_id = $2 AND (cliente = $3 OR (cliente IS NULL AND $3 = ''))`,
      [newName, usuarioId, oldName]
    );

    return res.json({ ok: true, message: "Campos renombrados con éxito." });
  } catch (error) {
    console.error("Fallo renombrar campos:", error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.delete("/api/inventario/campos/:name", async (req, res) => {
  try {
    const usuarioId = req.clienteSession?.user?.id;
    const name = String(req.params.name || "").trim();

    await query(
      `UPDATE lotes SET cliente = NULL WHERE usuario_id = $1 AND (cliente = $2 OR (cliente IS NULL AND $2 = ''))`,
      [usuarioId, name]
    );

    return res.json({ ok: true, message: "Campo eliminado de los lotes." });
  } catch (error) {
    console.error("Fallo eliminar campo:", error.message);
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

    const actualizado = await (async () => {
      const zonas = req.body?.zonas;
      let primaryProv = provincia;
      let primaryPart = partido;

      if (Array.isArray(zonas)) {
        const { geocodificarZona } = require("./services/onboarding");
        await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [usuarioRow.id]);
        
        const processedZonas = [];
        for (let i = 0; i < zonas.length; i++) {
          const z = zonas[i];
          const prov = String(z.provincia || "").trim();
          const part = String(z.partido || "").trim();
          if (!prov || !part) continue;

          let lat = z.lat != null ? Number(z.lat) : null;
          let lng = z.lng != null ? Number(z.lng) : null;

          if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            try {
              const geo = await geocodificarZona({ partido: part, provincia: prov });
              if (geo && !geo.error && !geo.noMatch) {
                lat = geo.lat;
                lng = geo.lng;
              }
            } catch (err) {
              console.error("Error geocodificando zona en perfil:", err.message);
            }
          }

          await query(
            `
              INSERT INTO usuario_zonas (usuario_id, provincia, partido, lat, lng, prioridad, activa)
              VALUES ($1, $2, $3, $4, $5, $6, true)
              ON CONFLICT (usuario_id, provincia, partido) DO NOTHING
            `,
            [usuarioRow.id, prov, part, lat, lng, i + 1]
          );
          processedZonas.push({ provincia: prov, partido: part, lat, lng });
        }

        if (processedZonas.length > 0) {
          primaryProv = processedZonas[0].provincia;
          primaryPart = processedZonas[0].partido;
          await query(
            `UPDATE usuarios SET lat = $1, lng = $2 WHERE id = $3`,
            [processedZonas[0].lat, processedZonas[0].lng, usuarioRow.id]
          );
        }
      }

      return actualizarUsuario(usuarioRow.id, {
        nombre,
        email,
        provincia: primaryProv,
        partido: primaryPart,
        tipo_comercializacion: tipoCom,
      });
    })();

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
  cron.schedule(
    "0 8,12,16,20 * * *",
    async () => {
      try {
        const { ejecutarAutodiagnosticoIA } = require("./services/ia_health_check");
        const res = await ejecutarAutodiagnosticoIA();
        console.log(`[IA Health Check] Cron ejecutado: status=${res.status} latencia=${(res.elapsed/1000).toFixed(2)}s`);
      } catch (error) {
        console.error("[IA Health Check] Error en cron periódico:", error.message);
      }
    },
    { timezone: tz }
  );
  console.log(
    "Cron configurado: pipeline diario + monitor de fuentes cada 30 min + reconcile MP cada 10 min + autodiagnóstico IA (AR)."
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
  
  // Ejecutar un autodiagnóstico inicial asíncrono no-bloqueante al iniciar
  setTimeout(async () => {
    try {
      const { ejecutarAutodiagnosticoIA } = require("./services/ia_health_check");
      await ejecutarAutodiagnosticoIA();
    } catch (error) {
      console.error("[IA Health Check] Error en autodiagnóstico inicial:", error.message);
    }
  }, 5000);
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
