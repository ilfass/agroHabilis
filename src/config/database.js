const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const poolMax = Number(process.env.DB_POOL_MAX || 8);
const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS || 30000);
const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000);
const statementTimeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000);
const queryTimeout = Number(process.env.DB_QUERY_TIMEOUT_MS || 30000);

if (!connectionString || !String(connectionString).trim()) {
  console.error(
    "[DB] DATABASE_URL vacía o no definida. Definila en .env (ej. postgresql://user:pass@host:5432/db)."
  );
}

const pool = new Pool({
  connectionString,
  max: Number.isFinite(poolMax) ? poolMax : 20,
  idleTimeoutMillis: Number.isFinite(idleTimeoutMillis) ? idleTimeoutMillis : 30000,
  connectionTimeoutMillis: Number.isFinite(connectionTimeoutMillis) ? connectionTimeoutMillis : 10000,
  statement_timeout: Number.isFinite(statementTimeout) ? statementTimeout : 30000,
  query_timeout: Number.isFinite(queryTimeout) ? queryTimeout : 30000,
  application_name: "agrohabilis-api",
});

pool.on("error", (err) => {
  console.error("[DB] Error en cliente del pool (suele ser cierre idle del servidor):", err?.message || err);
});

const query = (text, params) => pool.query(text, params);

const testConnection = async () => {
  try {
    await query("SELECT NOW()");
    console.log("Conexion a PostgreSQL exitosa.");
  } catch (error) {
    console.error("Error al conectar con PostgreSQL:", error.message);
    throw error;
  }
};

module.exports = {
  pool,
  query,
  testConnection,
};
