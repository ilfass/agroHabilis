const puppeteer = require("puppeteer");
const path = require("path");

async function run() {
  console.log("==> Launching headless browser to check computed styles...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

  const filePath = path.join(__dirname, "../frontend/public/cliente.html");
  await page.goto(`file://${filePath}`, { waitUntil: "networkidle2" });

  const getComputedStyle = async (selector) => {
    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return `Element not found: ${sel}`;
      const style = window.getComputedStyle(el);
      return {
        display: style.display,
        position: style.position,
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
        transform: style.transform,
        zIndex: style.zIndex,
        opacity: style.opacity,
        visibility: style.visibility,
        classList: Array.from(el.classList),
        offsetWidth: el.offsetWidth,
        offsetHeight: el.offsetHeight
      };
    }, selector);
  };

  console.log("\n--- COMPUTED STYLE OF .sidebar (INITIAL STATE) ---");
  console.log(await getComputedStyle(".sidebar"));

  console.log("\n--- COMPUTED STYLE OF #btnNavToggle (INITIAL STATE) ---");
  console.log(await getComputedStyle("#btnNavToggle"));

  console.log("\n==> Clicking #btnNavToggle...");
  try {
    await page.click("#btnNavToggle");
    await new Promise(r => setTimeout(r, 500));
  } catch (err) {
    console.error("Failed to click:", err.message);
  }

  console.log("\n--- COMPUTED STYLE OF .sidebar (AFTER CLICK) ---");
  console.log(await getComputedStyle(".sidebar"));

  await browser.close();
}

run().catch(console.error);
