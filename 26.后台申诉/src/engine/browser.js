// 本文件只负责受控浏览器的"拉起 / 附着 / 关闭"，按店铺 profile 隔离，不含任何业务判断。
// 机制说明（踩坑换来的，别随手改）：
// 1) 一个店铺 = 一个 profile 目录 + 一个固定调试端口；窗口一旦开着就**附着复用**，不重启（登录态在 profile 里）。
// 2) 端口上那个 Chrome 必须真的是本店铺 profile，否则不接（避免接错店、错店读数）。
//    做法：不用 CDP 的 Browser.getBrowserCommandLine（它要求 --enable-automation，我们故意不带）；
//    比对放 PowerShell 里做只回 MATCH/NO（纯 ASCII），期望值经环境变量传，避开中文路径乱码与引号转义。
// 3) 附着到的浏览器 close() 只断引用、不关窗口（keepOpen 语义）。
const fs = require("fs");
const net = require("net");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { chromium } = require("playwright-core");
const { log } = require("./log");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveBrowserPath() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("未找到可用的浏览器，请先安装 Google Chrome 或 Microsoft Edge。");
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function probeDebugPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    return null;
  }
}

function portUsesProfileDir(port, profileDir) {
  const script = [
    "$exp = $env:WO_EXPECT_DIR",
    "$hit = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" |",
    `  Where-Object { $_.CommandLine -match '--remote-debugging-port=${port}(\\s|$)' } |`,
    "  Where-Object { $_.CommandLine -match '--user-data-dir=\"?([^\"]+?)\"?(?:\\s|$)' -and $matches[1].TrimEnd([char]92) -ieq $exp.TrimEnd([char]92) } |",
    "  Select-Object -First 1",
    "if ($hit) { 'MATCH' } else { 'NO' }"
  ].join("\n");
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
      env: { ...process.env, WO_EXPECT_DIR: String(profileDir) }
    });
    return String(out).trim() === "MATCH";
  } catch (error) {
    return false;
  }
}

async function acquireDebugPort(preferredPort) {
  for (let offset = 0; offset < 20; offset += 1) {
    if (await isPortFree(preferredPort + offset)) return preferredPort + offset;
  }
  throw new Error(`调试端口 ${preferredPort} 起连续 20 个都被占用，无法拉起受控浏览器。`);
}

// 启动前先杀掉霸占本店铺 profile 的残留 Chrome（上次强退的孤儿/双开），否则新进程会并入旧实例、调试端口永远起不来。
function killChromeHoldingProfile(profileDir) {
  const needle = profileDir.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*--user-data-dir=' + '${needle}' + ' *') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore", timeout: 20000, windowsHide: true });
  } catch (error) {
    // 查杀失败不阻断，后面端口探测自然兜底
  }
}

// 附着已开着、且用的正是本店铺 profile 的窗口。失败一律返 null，交给调用方决定（不在这里猜）。
async function attachStoreBrowser({ profileDir, port, profileMatcherImpl }) {
  const info = await probeDebugPort(port);
  if (!info) return null;
  let browser = null;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  } catch (error) {
    return null;
  }
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    return null;
  }
  if (!(profileMatcherImpl || portUsesProfileDir)(port, profileDir)) {
    log("浏览器", "会话", "端口上不是本店铺 profile，不附着", `port=${port} profile=${path.basename(profileDir)}`);
    await browser.close().catch(() => {});
    return null;
  }
  log("浏览器", "会话", "已附着已有窗口（不重启、不动登录态）", `port=${port} profile=${path.basename(profileDir)}`);
  return {
    browser,
    context,
    port,
    attached: true,
    async close() { /* 已有窗口不关：只断引用 */ },
    isClosed() { return false; }
  };
}

// 拉起带店铺 profile 的受控浏览器，返回 { browser, context, port, close }。
// keepOpen=true（默认）：窗口一直留着，进程退出也不杀，下次靠端口附着复用。
async function openStoreBrowser({ profileDir, targetUrl, debugPort, keepOpen = true }) {
  const attached = await attachStoreBrowser({ profileDir, port: debugPort });
  if (attached) {
    if (targetUrl) {
      const page = await firstPage(attached.context, targetUrl);
      attached.page = page;
    }
    return attached;
  }
  fs.mkdirSync(profileDir, { recursive: true });
  killChromeHoldingProfile(profileDir);
  fs.rmSync(path.join(profileDir, "SingletonLock"), { force: true });
  const port = await acquireDebugPort(debugPort);
  const child = spawn(resolveBrowserPath(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--start-maximized",
    "--new-window",
    targetUrl || "about:blank"
  ], { detached: true, stdio: "ignore" });
  child.unref();

  let ready = false;
  for (let waited = 0; waited < 30000; waited += 500) {
    if (await probeDebugPort(port)) { ready = true; break; }
    await sleep(500);
  }
  if (!ready) {
    try { process.kill(child.pid); } catch (error) { /* 已退出 */ }
    throw new Error("受控浏览器 30 秒内未就绪，无法建立调试连接。");
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  log("浏览器", "会话", "已拉起受控浏览器", `pid=${child.pid} port=${port} profile=${path.basename(profileDir)}`);
  const page = await firstPage(context, targetUrl);
  return {
    browser,
    context,
    page,
    port,
    attached: false,
    async close() {
      if (keepOpen) {
        log("浏览器", "会话", "窗口保持打开（keepOpen 不关）", `port=${port}`);
        return;
      }
      await browser.close().catch(() => {});
      try { process.kill(child.pid); } catch (error) { /* 已退出 */ }
    },
    isClosed() { return false; }
  };
}

// 取一张页面：优先复用已开的同域页，否则开新页；避免每次都堆新标签。
async function firstPage(context, targetUrl) {
  const pages = context.pages().filter((page) => !page.isClosed());
  if (!targetUrl) return pages[0] || await context.newPage();
  const host = (() => { try { return new URL(targetUrl).host; } catch (error) { return ""; } })();
  const sameHost = pages.find((page) => { try { return new URL(page.url()).host === host && host; } catch (error) { return false; } });
  if (sameHost) {
    await sameHost.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
    await sameHost.bringToFront().catch(() => {});
    return sameHost;
  }
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.bringToFront().catch(() => {});
  return page;
}

module.exports = {
  openStoreBrowser,
  attachStoreBrowser,
  probeDebugPort,
  isPortFree,
  resolveBrowserPath,
  portUsesProfileDir,
  firstPage,
  sleep
};
