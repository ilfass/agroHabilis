"use strict";

require("dotenv").config();
const { crearSesionCliente, CLIENT_SESSION_COOKIE } = require("../src/services/cliente_auth");
const puppeteer = require("puppeteer");
const path = require("path");

async function main() {
  const userId = 538; // Néstor Palavecino
  console.log(`Generating real session for User ID: ${userId}...`);
  const ses = await crearSesionCliente({
    usuarioId: userId,
    ip: "127.0.0.1",
    userAgent: "HeadlessChrome"
  });
  console.log("Session generated:", ses.token);

  console.log("Launching Puppeteer...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1300, height: 950 });

  // Set the cookie for production domain
  await page.setCookie({
    name: CLIENT_SESSION_COOKIE,
    value: ses.token,
    domain: "agro.habilispro.com",
    path: "/"
  });

  console.log("Navigating to production dashboard...");
  await page.goto("https://agro.habilispro.com/cliente.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 6000)); // wait for AJAX loads

  const artifactDir = "/home/fabian/.gemini/antigravity-ide/brain/a6db2a8d-3851-459b-8d4f-91cfb246aa84";

  // Capture Resumen Tab first to confirm login
  console.log("Capturing Resumen Tab...");
  await page.screenshot({ path: path.join(artifactDir, "nestor_dashboard_resumen.png") });

  // Click on "agricultura_semillas" tab where lotes are listed and filter is visible
  console.log("Navigating to Agricultura/Siembras Tab...");
  await page.click('button[data-tab="agricultura_semillas"]');
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(artifactDir, "nestor_dashboard_agricultura_unfiltered.png") });

  // Let's filter by the newly renamed Establecimiento filter select
  console.log("Selecting 'San Jorge' field filter...");
  await page.select('select#filterCliente', 'San Jorge');
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(artifactDir, "nestor_dashboard_agricultura_filtered_sanjorge.png") });

  console.log("Closing browser...");
  await browser.close();
  console.log("Done!");
}

main().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
