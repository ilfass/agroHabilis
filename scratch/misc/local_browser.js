const puppeteer = require("puppeteer");

async function run() {
  console.log("==> Lanzando navegador local visible (headless: false)...");
  
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  console.log("==> Configurando cookie de sesión de producción para el dominio...");
  await page.setCookie({
    name: "ah_cliente_session",
    value: "pYRQmBPy3JaZZpf4cHTVvPmxUlmE0bD2PoQUiw-5rPE",
    domain: "agro.habilispro.com",
    path: "/"
  });

  console.log("==> Navigando a https://agro.habilispro.com/dashboard/cliente#telemetria ...");
  await page.goto("https://agro.habilispro.com/dashboard/cliente#telemetria", {
    waitUntil: "networkidle2"
  });

  console.log("==> Navegador abierto. Podés interactuar y probarlo en tiempo real en tu pantalla.");
  console.log("El script mantendrá la ventana abierta por 2 minutos. Podés cerrarla cuando quieras.");

  // Mantener abierto por 2 minutos
  await new Promise(r => setTimeout(r, 120000));

  console.log("Cerrando navegador automáticamente...");
  await browser.close();
}

run().catch(console.error);
