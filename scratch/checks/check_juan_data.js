const { Client } = require("pg");
require("dotenv").config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://habilis:habilis@localhost:5432/agro_habilis"
  });
  await client.connect();

  console.log("=== USER ===");
  const userRes = await client.query("SELECT * FROM usuarios WHERE id = 575");
  console.log(userRes.rows);

  console.log("\n=== LOTES ===");
  const lotesRes = await client.query("SELECT * FROM lotes WHERE usuario_id = 575");
  console.log(lotesRes.rows);

  console.log("\n=== SALDOS (INVENTARIO) ===");
  const saldosRes = await client.query("SELECT * FROM inventario_saldo WHERE usuario_id = 575");
  console.log(saldosRes.rows);

  console.log("\n=== ANIMALES INDIVIDUALES ===");
  const animalsRes = await client.query("SELECT * FROM animales_individuales WHERE usuario_id = 575");
  console.log(animalsRes.rows);

  console.log("\n=== ALERTAS ===");
  const alertasRes = await client.query("SELECT * FROM alertas WHERE usuario_id = 575");
  console.log(alertasRes.rows);

  await client.end();
}

main().catch(console.error);
