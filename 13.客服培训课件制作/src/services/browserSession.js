// 受控浏览器启动（机械能力）：独立资料目录 + 专用调试端口。
// 业务抓取仍由 jdFetch 负责，本模块只负责启动与端口就绪判断。
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

const WINDOWS_BROWSER_PATHS = {
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    pathFromLocalAppData('Google\\Chrome\\Application\\chrome.exe')
  ],
  edge: [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    pathFromLocalAppData('Microsoft\\Edge\\Application\\msedge.exe')
  ]
};

function pathFromLocalAppData(relativePath) {
  const localAppData = String(process.env.LOCALAPPDATA || '').trim();
  return localAppData ? require('path').join(localAppData, relativePath) : '';
}

function browserPaths(browser = 'auto') {
  const key = String(browser || 'auto').trim().toLowerCase();
  if (key === 'edge') return WINDOWS_BROWSER_PATHS.edge.filter(Boolean);
  if (key === 'chrome') return WINDOWS_BROWSER_PATHS.chrome.filter(Boolean);
  return [...WINDOWS_BROWSER_PATHS.edge, ...WINDOWS_BROWSER_PATHS.chrome].filter(Boolean);
}

function resolveBrowserExecutable(browser = 'auto', dependencies = {}) {
  const existsSync = dependencies.existsSync || fs.existsSync;
  const candidates = browserPaths(browser);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(`未找到可用的${String(browser).toLowerCase() === 'chrome' ? 'Chrome' : 'Edge/Chrome'}浏览器。`);
  }
  return executablePath;
}

function buildLaunchArgs({ port, userDataDir, targetUrl }) {
  if (!Number.isInteger(Number(port)) || Number(port) <= 0) throw new Error('启动浏览器失败：调试端口无效。');
  if (!String(userDataDir || '').trim()) throw new Error('启动浏览器失败：浏览器资料目录为空。');
  if (!String(targetUrl || '').trim()) throw new Error('启动浏览器失败：目标页面地址为空。');

  return [
    `--remote-debugging-port=${Number(port)}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--start-maximized',
    '--new-window',
    String(targetUrl)
  ];
}

function isLocalPortOpen(port, { host = '127.0.0.1', timeoutMs = 300 } = {}) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.connect(Number(port), host);
  });
}

async function waitForDebugPort(port, { timeoutMs = 15000, pollIntervalMs = 300, waitFn } = {}) {
  const wait = waitFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
  while (Date.now() <= deadline) {
    if (await isLocalPortOpen(port)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(Math.max(50, Number(pollIntervalMs) || 300), remaining));
  }
  return false;
}

function spawnVisibleBrowser(executablePath, args, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executablePath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.once('error', (error) => reject(new Error(`浏览器启动失败：${error.message}`)));
    child.once('spawn', () => resolve(child));
  });
}

async function launchVisibleBrowser({
  browser = 'auto',
  port,
  userDataDir,
  targetUrl,
  executablePath,
  dependencies = {}
} = {}) {
  const portNumber = Number(port);
  if (await (dependencies.isPortOpen || isLocalPortOpen)(portNumber)) {
    throw new Error(`调试端口 ${portNumber} 已被占用，请换端口或关闭占用它的受控浏览器。`);
  }

  const fsImpl = dependencies.fs || fs;
  fsImpl.mkdirSync(userDataDir, { recursive: true });
  const executable = executablePath || resolveBrowserExecutable(browser, dependencies);
  const args = buildLaunchArgs({ port: portNumber, userDataDir, targetUrl });
  const child = await spawnVisibleBrowser(executable, args, dependencies.spawn || spawn);
  if (typeof child.unref === 'function') child.unref();

  return { pid: child.pid || 0, browser, executablePath: executable, args, port: portNumber, userDataDir, targetUrl };
}

module.exports = {
  browserPaths,
  resolveBrowserExecutable,
  buildLaunchArgs,
  isLocalPortOpen,
  waitForDebugPort,
  spawnVisibleBrowser,
  launchVisibleBrowser
};
