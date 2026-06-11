require("dotenv").config();
const puppeteer = require("puppeteer");
const path = require("path");
const fs = require("fs");

async function run() {
  console.log("==> Iniciando verificación automatizada de navegador...");
  
  // 1. Cargar dependencias de AgroHabilis
  const { crearSesionCliente } = require("../src/services/cliente_auth");
  const { pool } = require("../src/config/database");

  console.log("==> Generando sesión segura para el usuario 487...");
  const ses = await crearSesionCliente({
    usuarioId: 487,
    ip: "127.0.0.1",
    userAgent: "Puppeteer Verification Bot"
  });
  
  console.log("Sesión generada con éxito.");
  
  // 2. Lanzar Puppeteer
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  
  const page = await browser.newPage();
  
  // Ajustar viewport grande para que se vea toda la pantalla tipo escritorio
  await page.setViewport({ width: 1440, height: 900 });

  // 3. Setear Cookie de Sesión
  await page.setCookie({
    name: "ah_cliente_session",
    value: ses.token,
    domain: "127.0.0.1",
    path: "/"
  });

  // Escuchar diálogos/alertas del navegador y aceptarlos
  page.on("dialog", async (dialog) => {
    console.log(`[Dialog/Alert] Tipo: ${dialog.type()}, Mensaje: "${dialog.message()}"`);
    await dialog.accept();
    console.log("Diálogo aceptado automáticamente.");
  });

  // 4. Navegar al Dashboard en el panel de telemetría
  console.log("Navigando a la sección de telemetría...");
  await page.goto("http://127.0.0.1:3000/dashboard/cliente#telemetria", {
    waitUntil: "networkidle2"
  });

  // Esperar un momento adicional para asegurar que todos los renderers terminen
  await new Promise(r => setTimeout(r, 3000));

  // 5. Capturar Pantalla de estado Desconectado
  const pathD = path.join(__dirname, "..", "frontend", "public", "telemetry_screenshot.png");
  await page.screenshot({ path: pathD, fullPage: false });
  console.log(`Screenshot Desconectado guardado en: ${pathD}`);

  // 6. Hacer clic en "Conectar" de John Deere
  console.log("Haciendo clic en 'Conectar' de John Deere...");
  const clicked = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("#telemetriaProveedoresContainer .mini-card"));
    const jdCard = cards.find(c => c.textContent.includes("John Deere"));
    if (jdCard) {
      const btn = jdCard.querySelector("button");
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    console.error("❌ No se pudo encontrar o hacer clic en el botón de John Deere.");
    await browser.close();
    await pool.end();
    process.exit(1);
  }

  console.log("Esperando recarga de labores y actualización de la UI...");
  await new Promise(r => setTimeout(r, 3000));

  // 7. Capturar Pantalla de estado Conectado (con labores)
  const pathC = path.join(__dirname, "..", "frontend", "public", "telemetry_connected_screenshot.png");
  await page.screenshot({ path: pathC, fullPage: false });
  console.log(`Screenshot Conectado guardado en: ${pathC}`);

  console.log("==> Pruebas de navegador finalizadas exitosamente.");
  
  await browser.close();
  await pool.end();
  
  console.log("\nURLs para verificar en tu navegador:");
  console.log("👉 https://agro.habilispro.com/telemetry_screenshot.png");
  console.log("👉 https://agro.habilispro.com/telemetry_connected_screenshot.png");
}

run().catch(async (e) => {
  console.error("❌ Fallo en la verificación:", e);
  try {
    const { pool } = require("../src/config/database");
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
