const puppeteer = require("puppeteer");
const path = require("path");

async function run() {
  console.log("==> Launching headless browser to test mobile view of cliente.html...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  
  // Set mobile viewport (iPhone X/12 dimensions)
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

  const filePath = path.join(__dirname, "../frontend/public/cliente.html");
  console.log(`==> Opening local HTML file: file://${filePath}`);
  
  // Navigate to the local file
  await page.goto(`file://${filePath}`, { waitUntil: "networkidle2" });

  // Take screenshot of the initial mobile view
  const initialPath = path.join(__dirname, "mobile_initial.png");
  console.log(`==> Taking initial screenshot: ${initialPath}`);
  await page.screenshot({ path: initialPath });

  // Click the "Menú" toggle button
  console.log("==> Attempting to click the 'Menú' toggle button (#btnNavToggle)...");
  try {
    await page.click("#btnNavToggle");
    // Wait for the transition to finish
    await new Promise(r => setTimeout(r, 500));
    
    // Take screenshot after clicking
    const openPath = path.join(__dirname, "mobile_open.png");
    console.log(`==> Taking screenshot after toggle: ${openPath}`);
    await page.screenshot({ path: openPath });
  } catch (err) {
    console.error("Failed to click toggle button:", err.message);
  }

  await browser.close();
  console.log("==> Done!");
}

run().catch(console.error);
