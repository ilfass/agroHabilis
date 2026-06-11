"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");
const { geocodificarZona } = require("../src/services/onboarding");

async function run() {
  const userId = 575;
  
  console.log("Cleaning old zones for user 575...");
  await query("DELETE FROM usuario_zonas WHERE usuario_id = $1", [userId]);
  
  const zones = [
    { partido: "Tandil", provincia: "Buenos Aires" },
    { partido: "Benito Juárez", provincia: "Buenos Aires" },
    { partido: "Laprida", provincia: "Buenos Aires" },
    { partido: "Adolfo González Chaves", provincia: "Buenos Aires" }
  ];
  
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const geo = await geocodificarZona({ partido: z.partido, provincia: z.provincia });
    console.log(`Geocoded ${z.partido} -> lat: ${geo.lat}, lng: ${geo.lng}`);
    await query(
      `INSERT INTO usuario_zonas (usuario_id, provincia, partido, lat, lng, prioridad, activa)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [userId, z.provincia, z.partido, geo.lat, geo.lng, i + 1]
    );
  }
  
  const tandilGeo = await geocodificarZona({ partido: "Tandil", provincia: "Buenos Aires" });
  await query(
    `UPDATE usuarios SET provincia = 'Buenos Aires', partido = 'Tandil', lat = $1, lng = $2 WHERE id = $3`,
    [tandilGeo.lat, tandilGeo.lng, userId]
  );
  
  console.log("Zones successfully restored!");
}

run().catch(console.error);
