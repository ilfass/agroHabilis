"use strict";

require("dotenv").config();
const { query } = require("../src/config/database");
const http = require("http");

const message = `¡Hola, Juan! 🌾

Analicé la foto del plano catastral y productivo del establecimiento *Don Martín* (Benito Juárez) que me mandaste. Logré extraer la siguiente lista de potreros/lotes y sus superficies correspondientes:

📋 *Detalle de Lotes y Superficies:*
• *Lote 1:* Potrero: 15.75 ha | Agrícola: 15.43 ha
• *Lote 1 Calle:* Potrero: 0.77 ha | Agrícola: 0.00 ha
• *Lote 2a:* Potrero: 2.85 ha | Agrícola: 0.00 ha
• *Lote 2b:* Potrero: 52.14 ha | Agrícola: 51.24 ha
• *Lote 2b Piq:* Potrero: 0.01 ha | Agrícola: 0.00 ha
• *Lote 3:* Potrero: 31.89 ha | Agrícola: 31.02 ha
• *Lote 3 Calle:* Potrero: 0.32 ha | Agrícola: 0.00 ha
• *Lote 4:* Potrero: 59.54 ha | Agrícola: 0.00 ha
• *Lote 4a:* Potrero: 10.73 ha | Agrícola: 10.36 ha
• *Lote 4b:* Potrero: 6.42 ha | Agrícola: 6.27 ha
• *Lote 5:* Potrero: 56.38 ha | Agrícola: 53.74 ha
• *Lote 6a:* Potrero: 44.76 ha | Agrícola: 41.74 ha
• *Lote 6b:* Potrero: 39.82 ha | Agrícola: 39.43 ha
• *Lote 6c:* Potrero: 1.03 ha | Agrícola: 0.00 ha
• *Lote 7a:* Potrero: 18.07 ha | Agrícola: 17.72 ha
• *Lote 7b:* Potrero: 12.40 ha | Agrícola: 0.00 ha
• *Lote 7c:* Potrero: 20.24 ha | Agrícola: 0.00 ha
• *Lote 7d:* Potrero: 19.26 ha | Agrícola: 18.94 ha
• *Lote 8:* Potrero: 40.81 ha | Agrícola: 40.04 ha
• *Lote 8b:* Potrero: 11.99 ha | Agrícola: 11.67 ha
• *Lote 9:* Potrero: 23.72 ha | Agrícola: 16.77 ha
• *Lote 9 Piq:* Potrero: 0.08 ha | Agrícola: 0.00 ha
• *Lote 9a:* Potrero: 40.94 ha | Agrícola: 40.40 ha
• *Lote 10:* Potrero: 74.07 ha | Agrícola: 73.49 ha
• *Lote 11:* Potrero: 42.92 ha | Agrícola: 41.76 ha
• *Lote 11 Piq:* Potrero: 0.01 ha | Agrícola: 0.00 ha
• *Lote 12:* Potrero: 1.93 ha | Agrícola: 0.00 ha
• *Lote 13:* Potrero: 5.50 ha | Agrícola: 0.00 ha
• *Lote 14:* Potrero: 7.68 ha | Agrícola: 0.00 ha
• *Lote 15:* Potrero: 25.38 ha | Agrícola: 0.00 ha
• *Calle 1:* Potrero: 0.96 ha | Agrícola: 0.00 ha
• *Calle 2:* Potrero: 2.36 ha | Agrícola: 0.00 ha
• *Calle 2b:* Potrero: 0.91 ha | Agrícola: 0.00 ha
• *Calle 3:* Potrero: 1.56 ha | Agrícola: 0.00 ha
• *Casco:* Potrero: 5.61 ha | Agrícola: 0.00 ha
• *Mol 1:* Potrero: 0.04 ha | Agrícola: 0.00 ha
• *Mol 2:* Potrero: 0.09 ha | Agrícola: 0.00 ha
• *Mol 3:* Potrero: 0.08 ha | Agrícola: 0.00 ha
• *Mol 4:* Potrero: 0.06 ha | Agrícola: 0.00 ha
• *Piq 1:* Potrero: 0.35 ha | Agrícola: 0.00 ha
• *TOTAL:* Potrero: 679.33 ha | Agrícola: 510.02 ha

¿Querés que agreguemos todos estos lotes y sus superficies de potrero (ha) al sistema bajo el establecimiento *Don Martín* para la firma *Daedaz Sociedad Anónima*? Confirmame con un "Sí" y los doy de alta automáticamente. 👍`;

async function main() {
  try {
    const resUser = await query(
      `SELECT id, whatsapp_jid, nombre FROM usuarios WHERE id = 575`
    );
    if (resUser.rows.length === 0) {
      console.error("No se encontró el usuario Juan Barreiro.");
      process.exit(1);
    }
    const user = resUser.rows[0];
    const jid = user.whatsapp_jid;
    console.log(`Encontrado Juan Barreiro (JID: ${jid}). Enviando análisis vía API...`);
    
    const postData = JSON.stringify({
      numero: jid,
      mensaje: message
    });

    const options = {
      hostname: "localhost",
      port: 3000,
      path: "/jobs/whatsapp-test",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        console.log("Response Status:", res.statusCode);
        console.log("Response Body:", body);
      });
    });

    req.on("error", (e) => {
      console.error(`Problem with request: ${e.message}`);
    });

    req.write(postData);
    req.end();
  } catch (err) {
    console.error("Error al enviar mensaje a Juan:", err);
  }
}

main();

