// 本文件只负责受控 Chrome 的拉起、CDP 连接与关闭，按店铺 profile 隔离，不含业务判断。
const fs = require("fs");
const net = require("net");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const { chromium } = require("playwright-core");
const appConfig = require("../config/appConfig");
const { ensureDir } = require("./fileSystem");
const { log } = require("./logger");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 崩溃/Ctrl+C 中途退出时同步杀掉在飞的受控 Chrome，避免孤儿窗口锁住店铺 profile。
const liveChildren = new Set();
process.on("exit", () => {
  for (const child of liveChildren) {
    try { child.kill(); } catch (error) { /* 已退出 */ }
  }
});

function resolveChromePath() {
  for (const chromePath of appConfig.chromeCandidates) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  throw new Error("未找到可用的浏览器，请先安装 Google Chrome 或 Microsoft Edge。");
}

function resolveStoreProfileDir(platformKey, storeKey) {
  return path.join(appConfig.browserProfilesRoot, platformKey, storeKey);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function acquireDebugPort(preferredPort) {
  let port = preferredPort;
  for (let offset = 0; offset < 20; offset += 1) {
    if (await isPortFree(port + offset)) {
      return port + offset;
    }
  }
  throw new Error(`调试端口 ${preferredPort} 起连续 20 个都被占用，无法拉起受控浏览器。`);
}

// 启动前先杀掉霸占本店铺 profile 的残留 Chrome（上次强退孤儿/双开）：否则新进程会并入旧实例导致调试端口永远起不来。
function killChromeHoldingProfile(profileDir) {
  const needle = profileDir.replace(/'/g, "''");
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like ('*--user-data-dir=' + '${needle}' + ' *') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore", timeout: 20000, windowsHide: true });
  } catch (error) {
    // 查杀失败不阻断启动，后面端口探测会自然兜底。
  }
}

// 拉起带店铺 profile 的受控 Chrome 并返回 { browser, context, close }。
// keepVisible=true 用于人工登录辅助；监控轮询默认也可见（京东对 headless 风险高，先保守）。
async function openStoreBrowser(options) {
  const { profileDir, targetUrl, debugPort } = options;
  ensureDir(profileDir);
  killChromeHoldingProfile(profileDir);
  fs.rmSync(path.join(profileDir, "SingletonLock"), { force: true });
  const port = await acquireDebugPort(debugPort || appConfig.baseDebugPort);
  const child = spawn(resolveChromePath(), [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--new-window",
    targetUrl || "about:blank"
  ], { detached: true, stdio: "ignore" });
  child.unref();
  liveChildren.add(child);

  let versionInfo = null;
  for (let waited = 0; waited < 30000; waited += 500) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        versionInfo = await res.json();
        break;
      }
    } catch (error) {
      // 端口还没就绪属于预期，继续等。
    }
    await sleep(500);
  }
  if (!versionInfo) {
    try { process.kill(child.pid); } catch (error) { /* 已退出 */ }
    throw new Error("受控浏览器 30 秒内未就绪，无法建立调试连接。");
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  log("浏览器", "会话", "已连接受控Chrome", `pid=${child.pid} port=${port} profile=${path.basename(profileDir)}`);

  let closed = false;
  return {
    browser,
    context,
    async close() {
      if (closed) return;
      closed = true;
      await browser.close().catch(() => {});
      liveChildren.delete(child);
      try { process.kill(child.pid); } catch (error) { /* 已退出 */ }
    }
  };
}

module.exports = { openStoreBrowser, resolveStoreProfileDir };
