CREATE TABLE IF NOT EXISTS cliente_auth_credentials (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  telefono_norm VARCHAR(24) NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  password_temporal_expires_at TIMESTAMPTZ,
  ultimo_password_cambio_en TIMESTAMPTZ,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cliente_auth_credentials_telefono
  ON cliente_auth_credentials (telefono_norm);

CREATE TABLE IF NOT EXISTS cliente_auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ip VARCHAR(64),
  user_agent TEXT,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revocada_en TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cliente_auth_sessions_usuario
  ON cliente_auth_sessions (usuario_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS idx_cliente_auth_sessions_exp
  ON cliente_auth_sessions (expires_at)
  WHERE revocada_en IS NULL;
