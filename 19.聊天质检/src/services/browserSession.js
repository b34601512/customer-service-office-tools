// 独立浏览器启动器：只负责拉起可见 Edge/Chrome 和等待 CDP 端口。
// 业务取数仍由 jdFetch 负责；不要在这里加入京东业务规则。
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

function localAppDataPath(relativePath) {
  const root = String(process.env.LOCALAPPDATA || '').trim();
  return root ? path.join(root, relativePath) : '';
}

const BROWSER_PATHS = {
  edge: [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    localAppDataPath('Microsoft\\Edge\\Application\\msedge.exe')
  ],
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    localAppDataPath('Google\\Chrome\\Application\\chrome.exe')
  ]
};

function candidateBrowserPaths(browser = 'auto') {
  const key = String(browser || 'auto').trim().toLowerCase();
  if (key === 'edge') return BROWSER_PATHS.edge.filter(Boolean);
  if (key === 'chrome') return BROWSER_PATHS.chrome.filter(Boolean);
  return [...BROWSER_PATHS.edge, ...BROWSER_PATHS.chrome].filter(Boolean);
}

function resolveBrowserExecutable(browser = 'auto', dependencies = {}) {
  const existsSync = dependencies.existsSync || fs.existsSync;
  const executablePath = candidateBrowserPaths(browser).find((item) => existsSync(item));
  if (!executablePath) {
    throw new Error(`未找到可用的${String(browser).toLowerCase() === 'chrome' ? 'Chrome' : 'Edge/Chrome'}浏览器。`);
  }
  return executablePath;
}

function buildLaunchArgs({ port, userDataDir, targetUrl }) {
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber <= 0) throw new Error('启动浏览器失败：调试端口无效。');
  if (!String(userDataDir || '').trim()) throw new Error('启动浏览器失败：浏览器资料目录为空。');
  if (!String(targetUrl || '').trim()) throw new Error('启动浏览器失败：目标页面地址为空。');

  // 关键点：专用 user-data-dir + 不恢复旧会话，避免复用现有 Edge 和额外恢复页。
  return [
    `--remote-debugging-port=${portNumber}`,
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

async function waitForDebugPort(port, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs) || 300);
  const wait = options.waitFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isOpen = options.isPortOpen || isLocalPortOpen;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await isOpen(port)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(pollIntervalMs, remaining));
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

async function launchVisibleBrowser(options = {}, dependencies = {}) {
  const port = Number(options.port);
  const userDataDir = String(options.userDataDir || '').trim();
  const targetUrl = String(options.targetUrl || '').trim();
  if (!Number.isInteger(port) || port <= 0) throw new Error('启动浏览器失败：调试端口无效。');
  if (!userDataDir) throw new Error('启动浏览器失败：浏览器资料目录为空。');
  if (!targetUrl) throw new Error('启动浏览器失败：目标页面地址为空。');
  const isPortOpen = dependencies.isPortOpen || isLocalPortOpen;
  if (await isPortOpen(port)) {
    throw new Error(`调试端口 ${port} 已被占用，请关闭占用它的受控浏览器或换端口。`);
  }

  const fsImpl = dependencies.fs || fs;
  fsImpl.mkdirSync(userDataDir, { recursive: true });
  const executablePath = options.executablePath || resolveBrowserExecutable(options.browser || 'auto', dependencies);
  const args = buildLaunchArgs({ port, userDataDir, targetUrl });
  const child = await spawnVisibleBrowser(executablePath, args, dependencies.spawn || spawn);
  if (typeof child.unref === 'function') child.unref();

  return {
    pid: child.pid || 0,
    browser: options.browser || 'auto',
    executablePath,
    args,
    port,
    userDataDir,
    targetUrl
  };
}

module.exports = {
  candidateBrowserPaths,
  resolveBrowserExecutable,
  buildLaunchArgs,
  isLocalPortOpen,
  waitForDebugPort,
  spawnVisibleBrowser,
  launchVisibleBrowser
};
