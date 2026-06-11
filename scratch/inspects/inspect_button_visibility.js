const puppeteer = require("puppeteer");
const path = require("path");

async function run() {
  console.log("==> Launching headless browser to check exact button position...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

  const filePath = path.join(__dirname, "../frontend/public/cliente.html");
  await page.goto(`file://${filePath}`, { waitUntil: "networkidle2" });

  const getElementCoordinates = async (selector) => {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return `Element not found: ${sel}`;
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
        opacity: style.opacity
      };
    }, selector);
  };

  console.log("\n--- COORDINATES OF #btnNavToggle ---");
  console.log(await getElementCoordinates("#btnNavToggle"));

  console.log("\n--- COORDINATES OF .header-bar ---");
  console.log(await getElementCoordinates(".header-bar"));

  await browser.close();
}

run().catch(console.error);
