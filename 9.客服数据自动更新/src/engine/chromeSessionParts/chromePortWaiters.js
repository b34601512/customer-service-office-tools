// 该文件用于解决 Chrome 调试端口探测、等待和连接错误归类问题。
const net = require("net");
const appConfig = require("../../config/appConfig");
const { wait } = require("./chromeSessionPaths");

async function isLocalPortOpen(port, options = {}) {
  // 这里用 TCP 探测避免黑洞端口导致 connectOverCDP 卡住，供状态轮询快速判断。
  const host = options.host || "127.0.0.1";
  const timeoutMs = Number(options.timeoutMs ?? 300);

  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let finished = false;

    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.removeAllListeners();
        socket.destroy();
      } finally {
        resolve(result);
      }
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForChromeDebugPortReady(options = {}) {
  // 这里统一等待调试端口真正就绪，避免浏览器刚拉起时各模块立刻接管导致偶发扑空。
  const port = Number(options.port ?? appConfig.tmall.remoteDebuggingPort);
  const host = options.host || "127.0.0.1";
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs) || 300);
  const probePort =
    options.probePort ||
    (() =>
      isLocalPortOpen(port, {
        host,
        timeoutMs: 300
      }));
  const waitFn = options.waitFn || wait;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await probePort()) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await waitFn(Math.min(pollIntervalMs, remainingMs));
  }

  return false;
}

async function waitForChromeDebugPortClosed(options = {}) {
  // 这里统一等待调试端口彻底释放，避免残留浏览器刚关到一半就立刻拉起新店浏览器，导致仍接到残留会话。
  const port = Number(options.port ?? appConfig.tmall.remoteDebuggingPort);
  const host = options.host || "127.0.0.1";
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
  const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs) || 300);
  const waitFn = options.waitFn || wait;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (!(await isLocalPortOpen(port, { host, timeoutMs: 300 }))) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await waitFn(Math.min(pollIntervalMs, remainingMs));
  }

  return false;
}

function isRetryableChromeConnectError(error) {
  // 这里把浏览器启动期常见瞬时错误集中归类，后续统一走重试而不是每个模块各自猜测。
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ECONNRESET|socket hang up|WebSocket|connectOverCDP|Unexpected status|Target closed|fetch failed/i.test(
    message
  );
}

module.exports = {
  isLocalPortOpen,
  waitForChromeDebugPortReady,
  waitForChromeDebugPortClosed,
  isRetryableChromeConnectError
};
