const puppeteer = require("puppeteer");

async function run() {
  console.log("==> Lanzando navegador local visible...");
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  console.log("==> Configurando cookie de sesión de producción...");
  await page.setCookie({
    name: "ah_cliente_session",
    value: "pYRQmBPy3JaZZpf4cHTVvPmxUlmE0bD2PoQUiw-5rPE",
    domain: "agro.habilispro.com",
    path: "/"
  });

  // Escuchar diálogos/alertas del navegador
  page.on("dialog", async (dialog) => {
    console.log(`[Alerta detectada en tu pantalla]: "${dialog.message()}"`);
    console.log("Esperando 2 segundos para que puedas leer la alerta en pantalla...");
    await new Promise(r => setTimeout(r, 2000));
    await dialog.accept();
    console.log("Alerta aceptada con éxito.");
  });

  // Capturar errores de la consola del navegador
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      console.log(`[CONSOLA BROWSER] [${type.toUpperCase()}] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    console.error("❌ [EXCEPTION BROWSER]:", err.message);
  });

  console.log("==> Navigando a https://agro.habilispro.com/dashboard/cliente#telemetria ...");
  await page.goto("https://agro.habilispro.com/dashboard/cliente#telemetria", {
    waitUntil: "networkidle2"
  });

  console.log("Esperando renderizado de la UI desvinculada (3 segundos)...");
  await new Promise(r => setTimeout(r, 3000));

  console.log("==> HACIENDO CLICK AUTOMÁTICO EN 'CONECTAR' DE JOHN DEERE...");
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
    console.error("❌ No se pudo encontrar el botón de John Deere.");
    await browser.close();
    process.exit(1);
  }

  console.log("Esperando que la alerta se muestre y se actualicen las labores en tiempo real...");
  await new Promise(r => setTimeout(r, 6000));

  console.log("==> ¡Sincronización completada! El navegador se mantendrá abierto por 2 minutos para que lo explores.");
  await new Promise(r => setTimeout(r, 120000));

  console.log("Cerrando navegador...");
  await browser.close();
}

run().catch(console.error);
