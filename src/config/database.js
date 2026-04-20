const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
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
