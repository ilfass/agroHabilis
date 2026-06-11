const puppeteer = require("puppeteer");
const path = require("path");

const ADMIN_KEY = "9061ad59d7d8062db617c2da3672576b0827972f451b725fa4774a5722369dca";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "/home/fabian/.gemini/antigravity-ide/brain/3b7c8cf2-08c9-41e5-bb7e-ace7d6159e8a";

(async () => {
  console.log("==> Iniciando Puppeteer...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ── 1. HACER LOGIN ──────────────────────────────────────────────────────────
  console.log("==> Haciendo login en admin...");
  await page.goto(`${BASE_URL}/dashboard/admin`, { waitUntil: "networkidle2" });

  // Esperar el formulario de login
  try {
    await page.waitForSelector('input[placeholder="ADMIN_KEY"]', { timeout: 5000 });
    await page.type('input[placeholder="ADMIN_KEY"]', ADMIN_KEY);
    await page.click('button[type="submit"], button:has-text("Ingresar"), .btn-primary');
    // Esperar redirección / carga del dashboard real
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));
    console.log("✓ Login realizado");
  } catch (e) {
    // Quizás ya pasó el login, intentamos vía API
    console.log("==> Login por formulario fallido, intentando via API...", e.message);
    const loginResult = await page.evaluate(async (key, base) => {
      const r = await fetch(`${base}/api/auth/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ adminKey: key })
      });
      return r.json();
    }, ADMIN_KEY, BASE_URL);
    console.log("Login API result:", JSON.stringify(loginResult));
    await new Promise(r => setTimeout(r, 1000));
  }

  // ── 2. TOMAR CAPTURAS ───────────────────────────────────────────────────────
  const targets = [
    { name: "dashboard", url: `${BASE_URL}/dashboard/admin` },
    { name: "usuarios",  url: `${BASE_URL}/dashboard/usuarios` },
    { name: "metricas",  url: `${BASE_URL}/dashboard/metricas` },
    { name: "ia",        url: `${BASE_URL}/dashboard/ia` },
    { name: "campanas",  url: `${BASE_URL}/dashboard/campanas` },
    { name: "planes",    url: `${BASE_URL}/dashboard/planes` },
  ];

  for (const target of targets) {
    console.log(`==> Navegando a ${target.url}...`);
    try {
      await page.goto(target.url, { waitUntil: "networkidle2" });
      await new Promise(r => setTimeout(r, 3000));
      const outputPath = path.join(ARTIFACT_DIR, `${target.name}.png`);
      await page.screenshot({ path: outputPath, fullPage: false });
      console.log(`✓ Captura guardada: ${outputPath}`);
    } catch (e) {
      console.error(`✗ Error capturando ${target.name}:`, e.message);
    }
  }

  await browser.close();
  console.log("==> Puppeteer terminado con éxito.");
  process.exit(0);
})().catch(err => {
  console.error("Fallo general:", err);
  process.exit(1);
});
