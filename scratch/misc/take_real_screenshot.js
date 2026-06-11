"use strict";

require("dotenv").config();
const { crearSesionCliente, CLIENT_SESSION_COOKIE } = require("../src/services/cliente_auth");
const puppeteer = require("puppeteer");
const path = require("path");

async function main() {
  const userId = 575; // Juan Barreiro
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

  // Set the cookie
  await page.setCookie({
    name: CLIENT_SESSION_COOKIE,
    value: ses.token,
    domain: "localhost",
    path: "/"
  });

  console.log("Navigating to dashboard...");
  await page.goto("http://localhost:3000/cliente.html", { waitUntil: "networkidle2" });
  await new Promise(r => setTimeout(r, 4000)); // wait for AJAX loads

  const artifactDir = "/home/fabian/.gemini/antigravity-ide/brain/a6db2a8d-3851-459b-8d4f-91cfb246aa84";

  // 1. Screenshot of Resumen Tab
  console.log("Capturing Resumen Tab...");
  await page.screenshot({ path: path.join(artifactDir, "real_screenshot_resumen.png") });

  // 2. Click on "agricultura_semillas" tab and capture
  console.log("Navigating to Agricultura Tab...");
  await page.click('button[data-tab="agricultura_semillas"]');
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(artifactDir, "real_screenshot_agricultura.png") });

  // 3. Click on "comandos" (Perfil) tab and capture
  console.log("Navigating to Perfil Tab...");
  await page.click('button[data-tab="comandos"]');
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(artifactDir, "real_screenshot_perfil.png") });

  console.log("Closing browser...");
  await browser.close();
  console.log("Done!");
}

main().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
