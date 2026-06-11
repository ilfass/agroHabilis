const puppeteer = require("puppeteer");
const path = require("path");

async function run() {
  console.log("==> Launching headless browser to check sidebar children positions...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });

  const filePath = path.join(__dirname, "../frontend/public/cliente.html");
  await page.goto(`file://${filePath}`, { waitUntil: "networkidle2" });

  // Click to open menu
  await page.click("#btnNavToggle");
  await new Promise(r => setTimeout(r, 500));

  const getChildrenDetails = async () => {
    return page.evaluate(() => {
      const sidebar = document.querySelector(".sidebar");
      if (!sidebar) return "Sidebar not found";
      
      const details = [];
      const children = sidebar.querySelectorAll(".brand, .nav-menu, .tab-link, .nav-section-title, .sidebar-footer");
      children.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        details.push({
          tagName: el.tagName,
          className: el.className,
          text: el.innerText.split("\n")[0],
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          color: style.color,
          display: style.display,
          opacity: style.opacity
        });
      });
      return details;
    });
  };

  console.log("\n--- DETAILED SIDEBAR CHILDREN POSITIONS ON MOBILE ---");
  const children = await getChildrenDetails();
  console.log(JSON.stringify(children, null, 2));

  await browser.close();
}

run().catch(console.error);
