const http = require("http");

const target = "19516432068824@lid"; // Cristian's JID

const message = `────────────────────────
¿Cómo estás, Cristian? Quería consultarte si la última respuesta y el análisis detallado de márgenes e insumos que te envié te resultaron satisfactorios, o si estabas buscando otro tipo de respuesta o algún dato específico adicional. ¡Quedo a tu total disposición! 🌾`;

const data = JSON.stringify({
  numero: target,
  mensaje: message
});

const options = {
  hostname: "localhost",
  port: 3000,
  path: "/jobs/whatsapp-test",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data)
  }
};

console.log("Sending POST request to localhost:3000/jobs/whatsapp-test to dispatch satisfaction check message...");

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

req.write(data);
req.end();
