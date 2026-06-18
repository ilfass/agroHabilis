const fs = require('fs');
const path = require('path');
const { query, testConnection } = require('../src/config/database');

async function run() {
  try {
    await testConnection();
    const sql = fs.readFileSync(path.join(__dirname, 'migration_campanias.sql'), 'utf8');
    console.log("Ejecutando migración...");
    await query(sql);
    console.log("Migración completada exitosamente.");
    process.exit(0);
  } catch (err) {
    console.error("Error ejecutando migración:", err);
    process.exit(1);
  }
}

run();
