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

// 探测某个调试端口上是否已有我们拉起的浏览器（常驻模式要附着复用，不能重启窗口）。
async function probeDebugPort(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    return null;
  }
}

// 判断某调试端口上的 Chrome 用的是不是指定 profile（身份真源）。
// 两个坑都避开了：
// 1) 不用 CDP 的 Browser.getBrowserCommandLine（它要求启动带 --enable-automation，而我们故意不带）；
// 2) 不让中文路径经 PowerShell→Node 往返（PowerShell 按 GBK 输出、Node 按 UTF-8 解会成乱码导致永远不等）——
//    比对放在 PowerShell 里做，只回 MATCH/NO（纯 ASCII）。期望值经环境变量传入，绕开引号转义。
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

// 附着一个已经开着、且用的正是本店铺 profile 的受控 Chrome（常驻监控复用同一个窗口，不重启、不动登录态）。
// 失败都返 null，由调用方决定是否新拉起；不在这里猜。
async function attachStoreBrowser(options) {
  const { profileDir, port, profileMatcherImpl } = options;
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
  // 端口上那个窗口必须真的是本店铺的 profile，否则不接（避免接错店、错店读数）。
  if (!(profileMatcherImpl || portUsesProfileDir)(port, profileDir)) {
    log("浏览器", "会话", "端口上不是本店铺 profile，不附着", `port=${port} profile=${path.basename(profileDir)}`);
    await browser.close().catch(() => {});
    return null;
  }
  log("浏览器", "会话", "已附着实控Chrome（窗口保持打开）", `port=${port} profile=${path.basename(profileDir)}`);
  let closed = false;
  return {
    browser,
    context,
    port,
    attached: true,
    async close() {
      // 常驻窗口不关：只断开本次引用，不关窗口、不杀进程。
      closed = true;
    },
    isClosed() { return closed; }
  };
}

// 拉起带店铺 profile 的受控 Chrome 并返回 { browser, context, port, close }。
// keepOpen=true 是常驻监控用：窗口一直留着（登录态也一直留着），close() 只断开引用、不杀窗口；
// 进程退出时也不杀（下次启动会先尝试附着同一个端口）。默认 false = 单轮巡检的开关行为。
async function openStoreBrowser(options) {
  const { profileDir, targetUrl, debugPort, keepOpen = false, reusePort = null } = options;
  if (reusePort) {
    const attached = await attachStoreBrowser({ profileDir, port: reusePort });
    if (attached) return attached;
  }
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
  if (keepOpen) {
    // 常驻模式：退出进程也不杀这个窗口，下次启动靠端口附着复用。
    liveChildren.delete(child);
  }

  let closed = false;
  return {
    browser,
    context,
    port,
    attached: false,
    async close() {
      if (closed) return;
      closed = true;
      if (keepOpen) {
        log("浏览器", "会话", "窗口保持打开（常驻模式不关）", `port=${port} profile=${path.basename(profileDir)}`);
        return;
      }
      await browser.close().catch(() => {});
      liveChildren.delete(child);
      try { process.kill(child.pid); } catch (error) { /* 已退出 */ }
    },
    isClosed() { return closed; }
  };
}

module.exports = { openStoreBrowser, attachStoreBrowser, probeDebugPort, isPortFree, resolveStoreProfileDir, portUsesProfileDir };
