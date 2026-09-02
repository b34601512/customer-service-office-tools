const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-test-"));
const child = spawn(chromePath, [
  "--remote-debugging-port=9333",
  "--remote-allow-origins=*",
  "--user-data-dir=" + profile,
  "--no-first-run",
  "--headless=new",
  "about:blank"
], { stdio: "ignore" });

setTimeout(async () => {
  try {
    const { chromium } = require("playwright-core");
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 15000 });
    console.log("CONNECT OK with remote-allow-origins=*");
    await browser.close();
    process.exit(0);
  } catch (e) {
    console.error("CONNECT FAIL:", e.message);
    process.exit(1);
  }
}, 4000);

child.on("exit", (code) => {
  if (code !== null) console.log("chrome exited", code);
});
