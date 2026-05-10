const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { query } = require("../config/database");

const CLIENT_SESSION_COOKIE = "ah_cliente_session";
const CLIENT_SESSION_TTL_MS = Number(process.env.CLIENT_SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const CLIENT_TEMP_PASSWORD_TTL_HOURS = Number(process.env.CLIENT_TEMP_PASSWORD_TTL_HOURS || 24);
const CLIENT_TEMP_PASSWORD_LENGTH = Number(process.env.CLIENT_TEMP_PASSWORD_LENGTH || 10);
const BCRYPT_ROUNDS = Number(process.env.CLIENT_PASSWORD_BCRYPT_ROUNDS || 10);

const normalizarTelefono = (value = "") => String(value || "").replace(/\D/g, "");

const generarPasswordTemporal = (length = CLIENT_TEMP_PASSWORD_LENGTH) => {
  const safeLength = Math.max(8, Math.min(24, Number(length) || 10));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(safeLength);
  let out = "";
  for (let i = 0; i < safeLength; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
};

const hashPassword = async (plain) => {
  const rounds = Number.isFinite(BCRYPT_ROUNDS) ? Math.max(8, Math.min(14, BCRYPT_ROUNDS)) : 10;
  return bcrypt.hash(plain, rounds);
};

const getSessionCookieValue = (req) => {
  const raw = String(req.headers.cookie || "");
  if (!raw) return null;
  const parts = raw.split(";").map((x) => x.trim()).filter(Boolean);
  for (const pair of parts) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = decodeURIComponent(pair.slice(0, eq).trim());
    if (key !== CLIENT_SESSION_COOKIE) continue;
    return decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return null;
};

const hashSessionToken = (token) =>
  crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");

const crearSesionCliente = async ({ usuarioId, ip, userAgent }) => {
  const issuedAt = Date.now();
  const expiresAt = new Date(issuedAt + CLIENT_SESSION_TTL_MS);
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  await query(
    `
      INSERT INTO cliente_auth_sessions (
        session_token_hash, usuario_id, ip, user_agent, expires_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [tokenHash, usuarioId, ip || null, userAgent || null, expiresAt]
  );
  return { token, expiresAt: expiresAt.toISOString() };
};

const invalidarSesionCliente = async (token) => {
  if (!token) return;
  await query(
    `
      UPDATE cliente_auth_sessions
      SET revocada_en = NOW()
      WHERE session_token_hash = $1
        AND revocada_en IS NULL
    `,
    [hashSessionToken(token)]
  );
};

const limpiarSesionesExpiradas = async () => {
  await query(
    `
      DELETE FROM cliente_auth_sessions
      WHERE expires_at < NOW() - INTERVAL '7 days'
         OR revocada_en < NOW() - INTERVAL '7 days'
    `
  );
};

const buscarCredencialesPorTelefono = async (telefonoRaw) => {
  const telefono = normalizarTelefono(telefonoRaw);
  if (!telefono) return null;
  const r = await query(
    `
      SELECT
        u.id AS usuario_id,
        u.nombre,
        COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
        c.telefono_norm,
        c.password_hash,
        c.password_temporal_expires_at,
        c.must_change_password
      FROM usuarios u
      JOIN cliente_auth_credentials c ON c.usuario_id = u.id
      WHERE regexp_replace(COALESCE(u.whatsapp, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(u.whatsapp_real, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(u.whatsapp_jid, ''), '\\D', '', 'g') = $1
      LIMIT 1
    `,
    [telefono]
  );
  return r.rows[0] || null;
};

const autenticarCliente = async ({ telefono, password, ip, userAgent }) => {
  const creds = await buscarCredencialesPorTelefono(telefono);
  if (!creds?.password_hash) return { ok: false };
  const validPassword = await bcrypt.compare(String(password || ""), creds.password_hash);
  if (!validPassword) return { ok: false };
  if (creds.must_change_password && creds.password_temporal_expires_at) {
    const exp = new Date(creds.password_temporal_expires_at).getTime();
    if (Number.isFinite(exp) && exp < Date.now()) {
      return { ok: false };
    }
  }
  const ses = await crearSesionCliente({
    usuarioId: creds.usuario_id,
    ip,
    userAgent,
  });
  return {
    ok: true,
    sessionToken: ses.token,
    expiresAt: ses.expiresAt,
    usuario: {
      id: creds.usuario_id,
      nombre: creds.nombre || null,
      whatsapp: creds.whatsapp || null,
      telefono: creds.telefono_norm || normalizarTelefono(telefono),
    },
    mustChangePassword: Boolean(creds.must_change_password),
  };
};

const leerSesionCliente = async (req) => {
  const token = getSessionCookieValue(req);
  if (!token) return { ok: false, reason: "missing_cookie" };
  const r = await query(
    `
      SELECT
        s.id AS session_id,
        s.usuario_id,
        s.expires_at,
        u.nombre,
        COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp,
        c.must_change_password
      FROM cliente_auth_sessions s
      JOIN usuarios u ON u.id = s.usuario_id
      LEFT JOIN cliente_auth_credentials c ON c.usuario_id = s.usuario_id
      WHERE s.session_token_hash = $1
        AND s.revocada_en IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [hashSessionToken(token)]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: "invalid_or_expired" };
  return {
    ok: true,
    token,
    sessionId: row.session_id,
    user: {
      id: row.usuario_id,
      nombre: row.nombre || null,
      whatsapp: row.whatsapp || null,
    },
    expiresAt: row.expires_at,
    mustChangePassword: Boolean(row.must_change_password),
  };
};

const revocarSesionesPorUsuarioId = async (usuarioId) => {
  await query(
    `
      UPDATE cliente_auth_sessions
      SET revocada_en = NOW()
      WHERE usuario_id = $1
        AND revocada_en IS NULL
    `,
    [usuarioId]
  );
};

/**
 * Guarda hash de contraseña temporal e invalida sesiones web del usuario.
 */
const persistirPasswordTemporalCliente = async ({ usuarioId, telefonoNorm, plain }) => {
  const tnorm = normalizarTelefono(telefonoNorm);
  if (!usuarioId || !tnorm) {
    throw new Error("persistirPasswordTemporalCliente: faltan datos");
  }
  const temporalHash = await hashPassword(String(plain || ""));
  await query(
    `
      INSERT INTO cliente_auth_credentials (
        usuario_id, telefono_norm, password_hash, must_change_password, password_temporal_expires_at
      )
      VALUES ($1, $2, $3, true, NOW() + ($4::text || ' hours')::interval)
      ON CONFLICT (usuario_id)
      DO UPDATE SET
        telefono_norm = EXCLUDED.telefono_norm,
        password_hash = EXCLUDED.password_hash,
        must_change_password = true,
        password_temporal_expires_at = EXCLUDED.password_temporal_expires_at,
        actualizado_en = NOW()
    `,
    [usuarioId, tnorm, temporalHash, String(Math.max(1, CLIENT_TEMP_PASSWORD_TTL_HOURS))]
  );
  await revocarSesionesPorUsuarioId(usuarioId);
};

const buildTextoCredencialCliente = ({
  dashboardLink,
  telefonoMuestra,
  passwordTemporal,
  variant = "suscripcion",
}) => {
  const link = String(
    dashboardLink || process.env.CLIENT_DASHBOARD_URL || "https://agro.habilispro.com/dashboard/cliente/login"
  ).trim();
  const intro =
    variant === "reenvio"
      ? "Pediste una nueva contraseña para ingresar al panel web (AgroHabilis)."
      : "Tu suscripción fue confirmada y tu plan está activo.";
  const emoji = variant === "reenvio" ? "🔑 " : "✅ ";
  return [
    `${emoji}${intro}`,
    "",
    `Acceso panel cliente: ${link}`,
    `Teléfono detectado: ${telefonoMuestra}`,
    `Contraseña temporal: ${passwordTemporal}`,
    "",
    "Al ingresar te vamos a pedir cambiar esta contraseña.",
  ].join("\n");
};

const buscarUsuarioPorTelefonoNormalizado = async (telefonoNorm) => {
  const t = normalizarTelefono(telefonoNorm);
  if (!t) return null;
  const r = await query(
    `
      SELECT
        u.id,
        COALESCE(NULLIF(u.whatsapp_real, ''), u.whatsapp) AS whatsapp
      FROM usuarios u
      WHERE regexp_replace(COALESCE(u.whatsapp, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(u.whatsapp_real, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(u.whatsapp_jid, ''), '\\D', '', 'g') = $1
      LIMIT 1
    `,
    [t]
  );
  return r.rows[0] || null;
};

/**
 * Envía WhatsApp y solo entonces persiste la nueva temporal (evita dejar contraseña rotada sin mensaje).
 */
const ejecutarReenvioPasswordPanelCliente = async ({ telefonoRaw }) => {
  const telefonoNorm = normalizarTelefono(telefonoRaw);
  if (!telefonoNorm || telefonoNorm.length < 8) {
    return { ok: false, code: "invalid_phone" };
  }
  const usuario = await buscarUsuarioPorTelefonoNormalizado(telefonoNorm);
  if (!usuario) {
    return { ok: true, encontrado: false };
  }
  const plain = generarPasswordTemporal();
  const { sendMessage } = require("../config/whatsapp");
  const msg = buildTextoCredencialCliente({
    telefonoMuestra: telefonoNorm,
    passwordTemporal: plain,
    variant: "reenvio",
  });
  await sendMessage(telefonoNorm, msg);
  await persistirPasswordTemporalCliente({ usuarioId: usuario.id, telefonoNorm, plain });
  return { ok: true, encontrado: true };
};

const cambiarPasswordCliente = async ({ usuarioId, passwordActual, passwordNueva }) => {
  const r = await query(
    `
      SELECT password_hash
      FROM cliente_auth_credentials
      WHERE usuario_id = $1
      LIMIT 1
    `,
    [usuarioId]
  );
  const currentHash = r.rows[0]?.password_hash;
  if (!currentHash) return { ok: false, reason: "not_found" };
  const valid = await bcrypt.compare(String(passwordActual || ""), currentHash);
  if (!valid) return { ok: false, reason: "invalid_current" };

  const nextHash = await hashPassword(String(passwordNueva || ""));
  await query(
    `
      UPDATE cliente_auth_credentials
      SET
        password_hash = $2,
        must_change_password = false,
        password_temporal_expires_at = NULL,
        ultimo_password_cambio_en = NOW(),
        actualizado_en = NOW()
      WHERE usuario_id = $1
    `,
    [usuarioId, nextHash]
  );
  await revocarSesionesPorUsuarioId(usuarioId);
  return { ok: true };
};

const regenerarPasswordTemporalCliente = async ({ usuarioId, telefono }) => {
  const telefonoNorm = normalizarTelefono(telefono);
  if (!usuarioId || !telefonoNorm) {
    throw new Error("Faltan usuarioId o telefono para regenerar credenciales");
  }
  const temporal = generarPasswordTemporal();
  await persistirPasswordTemporalCliente({ usuarioId, telefonoNorm, plain: temporal });
  return {
    telefono: telefonoNorm,
    passwordTemporal: temporal,
    expiraEnHoras: Math.max(1, CLIENT_TEMP_PASSWORD_TTL_HOURS),
  };
};

module.exports = {
  CLIENT_SESSION_COOKIE,
  CLIENT_SESSION_TTL_MS,
  normalizarTelefono,
  autenticarCliente,
  leerSesionCliente,
  invalidarSesionCliente,
  limpiarSesionesExpiradas,
  cambiarPasswordCliente,
  regenerarPasswordTemporalCliente,
  generarPasswordTemporalCliente: () => generarPasswordTemporal(),
  persistirPasswordTemporalCliente,
  buildTextoCredencialCliente,
  ejecutarReenvioPasswordPanelCliente,
};
