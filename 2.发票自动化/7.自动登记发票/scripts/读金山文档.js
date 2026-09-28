// 读金山文档（WPS 文档形态，非表格）正文：匿名无头打开分享链接，边滚边收集（虚拟滚动，一次 innerText 拿不全）。
// 用法：NODE_PATH="D:/桌面/办公软件/25.京东换货登记核查/node_modules" node scripts/读金山文档.js <分享链接> <输出txt>
// 依赖：playwright-core（借 25号 的 node_modules）+ 本机 Chrome/Edge。只读，不登录、不改文档。
const { chromium } = require("playwright-core");
const fs = require("fs");

(async () => {
  const exe = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  try {
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1680, height: 1200 } });
    await page.goto(process.argv[2], { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(10000);

    const sel = ".otl-scroll-container";
    const seen = new Set();
    const ordered = [];
    let stale = 0;
    for (let step = 0; step < 120 && stale < 20; step += 1) {
      const lines = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? el.innerText.split("\n") : [];
      }, sel);
      let added = 0;
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (!seen.has(t)) { seen.add(t); ordered.push(t); added += 1; }
      }
      stale = added === 0 ? stale + 1 : 0;
      const moved = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        const before = el.scrollTop;
        el.scrollTop = Math.min(el.scrollTop + Math.round(el.clientHeight * 0.75), el.scrollHeight);
        return el.scrollTop > before;
      }, sel);
      if (!moved) break;
      await page.waitForTimeout(500);
    }
    fs.writeFileSync(process.argv[3], ordered.join("\n"), "utf8");
    console.log("DONE lines=" + ordered.length + " chars=" + ordered.join("\n").length);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
