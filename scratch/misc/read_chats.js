"use strict";
require('dotenv').config();
const { query } = require('../src/config/database');
async function main() {
  const res = await query(
    'SELECT creado_en, pregunta, respuesta, ia_provider, whatsapp, ia_provider_trace FROM historial_consultas WHERE pregunta = $1 OR ia_provider_trace::text LIKE $2 ORDER BY creado_en DESC LIMIT 10',
    ['[Audio/Imagen recibido]', '%fallback_ocr_o_audio_error%']
  );
  console.log(`Encontrados ${res.rows.length} registros.`);
  for (const row of res.rows) {
    console.log(`===========================================`);
    console.log(`[${row.creado_en.toISOString()}] (IA: ${row.ia_provider}) (whatsapp: ${row.whatsapp})`);
    console.log(`P: ${row.pregunta}`);
    console.log(`R: ${row.respuesta}`);
    console.log(`TRACE:`, JSON.stringify(row.ia_provider_trace, null, 2));
  }
}
main().catch(console.error);
