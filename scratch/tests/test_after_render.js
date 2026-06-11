const puppeteer = require("puppeteer");
const path = require("path");

async function run() {
  console.log("==> Launching browser...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

  const filePath = path.join(__dirname, "../frontend/public/cliente.html");
  await page.goto(`file://${filePath}`, { waitUntil: "networkidle2" });

  // Let's run a script inside the page to mock renderPremiumDashboardDesign
  console.log("==> Injecting and executing renderPremiumDashboardDesign with mock data...");
  const coordinates = await page.evaluate(() => {
    // Mock the data
    const mockData = {
      usuario: {
        nombre: "Néstor Palavecino",
        partido: "Balcarce",
        plan: "Pro"
      },
      ganaderiaPerfil: [],
      animalesIndividuales: [],
      lotes: [],
      clima: []
    };

    // Override the alert to not block
    window.alert = () => {};

    // Execute renderPremiumDashboardDesign directly
    renderPremiumDashboardDesign(mockData);

    // Now get the properties of `#btnNavToggle` and `.header-bar`
    const btn = document.querySelector("#btnNavToggle");
    const header = document.querySelector(".header-bar");
    
    const getRectAndStyle = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        visibility: style.visibility,
        display: style.display,
        opacity: style.opacity,
        innerHTML: el.innerHTML,
        outerHTML: el.outerHTML
      };
    };

    return {
      btn: getRectAndStyle(btn),
      header: getRectAndStyle(header)
    };
  });

  console.log("\n--- AFTER RENDER: #btnNavToggle ---");
  console.log(JSON.stringify(coordinates.btn, null, 2));

  console.log("==> Saving screenshot to scratch/mobile_after_render.png...");
  await page.screenshot({ path: "scratch/mobile_after_render.png" });

  await browser.close();
}

run().catch(console.error);
