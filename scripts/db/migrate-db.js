require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { query, pool, testConnection } = require("../../src/config/database");

const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

async function asegurarTablaMigraciones() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(200) NOT NULL UNIQUE,
      ejecutada_en TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function obtenerMigracionesPendientes() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const done = await query("SELECT nombre FROM schema_migrations");
  const doneSet = new Set((done.rows || []).map((r) => r.nombre));
  return files.filter((f) => !doneSet.has(f));
}

async function run() {
  try {
    await testConnection();
    await asegurarTablaMigraciones();
    const pendientes = await obtenerMigracionesPendientes();
    if (!pendientes.length) {
      console.log("Sin migraciones pendientes.");
      return;
    }
    for (const nombre of pendientes) {
      const fullPath = path.join(MIGRATIONS_DIR, nombre);
      const sql = fs.readFileSync(fullPath, "utf8");
      if (!sql.trim()) continue;
      console.log(`Ejecutando migracion: ${nombre}`);
      await query(sql);
      await query("INSERT INTO schema_migrations (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING", [
        nombre,
      ]);
    }
    console.log("Migraciones aplicadas correctamente.");
  } catch (error) {
    console.error("Error en migraciones:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
