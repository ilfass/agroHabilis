#!/usr/bin/env node
/**
 * Solo DB + WhatsApp: imprime el QR en esta terminal (sin HTTP ni cron).
 * Uso: npm run wa:qr
 * WHATSAPP_QR_TERMINAL_SMALL=1 para QR ASCII más chico en pantallas angostas.
 */
require("dotenv").config();
const path = require("path");

async function main() {
  const { testConnection } = require(path.join(
    __dirname,
    "..",
    "..",
    "src",
    "config",
    "database"
  ));
  const { initializeWhatsApp, estaListo } = require(path.join(
    __dirname,
    "..",
    "..",
    "src",
    "config",
    "whatsapp"
  ));

  await testConnection();
  console.log(
    "\n=== WhatsApp: QR en esta terminal (Ctrl+C para salir) ===\n"
  );

  process.on("SIGINT", () => {
    console.log("\n[wa:qr] Salida.");
    process.exit(0);
  });

  await initializeWhatsApp();

  if (estaListo()) {
    console.log("[wa:qr] Ya había sesión; WhatsApp listo. Ctrl+C para salir.");
  } else {
    console.log(
      "[wa:qr] Esperando escaneo… Cuando veas «WhatsApp conectado», listo."
    );
  }

  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[wa:qr]", err?.message || err);
  process.exit(1);
});
