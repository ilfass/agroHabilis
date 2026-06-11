"use strict";

const path = require("path");
// Cargar dotenv desde el raíz del proyecto
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const { detectarIntencionIA } = require("../../src/services/intent_classifier");
const { procesarConsulta } = require("../../src/services/agent/pipeline/consulta_whatsapp");
const { query } = require("../../src/config/database");

// JID de prueba (Pedro Agricultor, configurado en la base de datos local)
const testJid = "5491100001001"; 

const testQueries = [
  "¿cómo va a estar el clima este fin de semana?",
  "¿a cuánto cotiza la soja hoy?",
  "anotá que gasté 320000 pesos en urea",
  "Registrá que vendí 120 toneladas de maíz",
  "mandame mi resumen de alertas"
];

async function runEndToEndTests() {
  console.log("==================================================");
  console.log("🚀 INICIANDO TEST INTEGRADO DE PIPELINE HÍBRIDO NLU");
  console.log("==================================================\n");

  // Verificar perfil del usuario de prueba
  const userCheck = await query(
    "SELECT id, nombre, partido, provincia FROM usuarios WHERE id = 28 OR whatsapp_real = $1 OR whatsapp = $1 LIMIT 1",
    [testJid]
  );
  
  if (!userCheck.rows.length) {
    console.error("❌ ERROR: No se encontró un usuario de prueba adecuado en la base de datos.");
    process.exit(1);
  }
  
  const user = userCheck.rows[0];
  console.log(`👤 Usuario de prueba: ${user.nombre} (${user.partido}, ${user.provincia}) - ID: ${user.id}\n`);

  for (const queryText of testQueries) {
    console.log(`💬 Productor dice: "${queryText}"`);
    console.log("--------------------------------------------------");
    
    try {
      console.log("1. Ejecutando Extracción NLU...");
      const intencionIA = await detectarIntencionIA(queryText);
      console.log(`   - Intención: '${intencionIA.tipo}'`);
      console.log(`   - Comando: '${intencionIA.comando || "null"}'`);
      console.log(`   - Parámetros:`, JSON.stringify(intencionIA.parametros));
      
      console.log("2. Enviando al Pipeline Híbrido (consulta_whatsapp)...");
      const start = Date.now();
      const respuesta = await procesarConsulta(testJid, queryText, {
        intencionPrecalculada: intencionIA,
        numeroReal: testJid
      });
      const end = Date.now();
      
      console.log(`3. Respuesta Final (${end - start}ms):`);
      console.log(`"""\n${respuesta}\n"""`);
    } catch (err) {
      console.error("❌ ERROR DURANTE EL TEST:", err);
    }
    console.log("==================================================\n");
  }
  
  console.log("🏁 Pruebas integradas finalizadas con éxito.");
  process.exit(0);
}

runEndToEndTests().catch((e) => {
  console.error("Fallo fatal:", e);
  process.exit(1);
});
