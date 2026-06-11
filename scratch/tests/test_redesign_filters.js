const { Client } = require("pg");
require("dotenv").config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://habilis:habilis@localhost:5432/agro_habilis"
  });
  await client.connect();

  console.log("Creating a test lote for user 575...");
  const tempName = "Lote Test " + Date.now();
  const insertRes = await client.query(
    `INSERT INTO lotes (usuario_id, nombre, hectareas, cultivo, arrendado, cliente, firma, provincia, partido, tipo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      575,
      tempName,
      120.5,
      "Maíz",
      true,
      "Daedas Sociedad Anónima",
      "Las Margaritas",
      "Buenos Aires",
      "Tandil",
      "feedlot"
    ]
  );
  
  const createdLote = insertRes.rows[0];
  console.log("Created Lote:", createdLote);

  if (
    createdLote.firma === "Las Margaritas" &&
    createdLote.provincia === "Buenos Aires" &&
    createdLote.partido === "Tandil" &&
    createdLote.tipo === "feedlot"
  ) {
    console.log("✓ SUCCESS: New columns correctly persisted in DB!");
  } else {
    throw new Error("✗ FAILED: Columns not correctly persisted.");
  }

  // Clean up
  await client.query("DELETE FROM lotes WHERE id = $1", [createdLote.id]);
  console.log("✓ Test lote cleaned up successfully.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
