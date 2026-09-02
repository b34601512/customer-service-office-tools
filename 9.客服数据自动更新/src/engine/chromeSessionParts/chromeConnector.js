// 该文件用于解决 CDP 连接、目标页面等待和只断开 Playwright 会话问题。
const appConfig = require("../../config/appConfig");
const { log } = require("../logger");
const { loadPlaywrightCore } = require("../playwrightProvider");
const { wait } = require("./chromeSessionPaths");
const { waitForChromeDebugPortReady, isRetryableChromeConnectError } = require("./chromePortWaiters");

// 无论从 BAT、TUI 还是直接调用汇总链路启动，都必须让本机 CDP 请求绕过系统代理。
// 否则代理会把 127.0.0.1 的调试请求改写成 400/502，自动登录流程根本无法开始。
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;

async function connectToChrome(options = {}) {
  // 这里通过 CDP 接管已打开的 Chrome，保证用户登录后无需重新开浏览器。
  const { chromium } = loadPlaywrightCore();
  const timeoutMs = Number(options.timeoutMs ?? appConfig.tmall.connectTimeoutMs);
  const shouldLog = options.shouldLog !== false;
  const connectRetryIntervalMs = Math.max(100, Number(options.connectRetryIntervalMs) || 300);
  const portReadyTimeoutMs = Math.max(
    1000,
    Number(options.portReadyTimeoutMs) || Math.min(timeoutMs, 15000)
  );

  if (shouldLog) {
    log("主线:连接", "浏览器引擎", "接管会话", `准备连接 Chrome：${appConfig.tmall.cdpEndpoint}`);
  }

  const debugPortReady = await waitForChromeDebugPortReady({
    timeoutMs: portReadyTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    host: options.host,
    port: options.port,
    probePort: options.probePort,
    waitFn: options.waitFn
  });
  if (!debugPortReady) {
    throw new Error("未检测到当前汇总任务的调试浏览器，请重新执行本店汇总。");
  }

  const deadline = Date.now() + timeoutMs;
  let hasLoggedRetry = false;
  let lastRetryableError = null;

  while (Date.now() <= deadline) {
    const remainingMs = deadline - Date.now();
    try {
      return await chromium.connectOverCDP(appConfig.tmall.cdpEndpoint, {
        timeout: Math.max(1000, Math.min(timeoutMs, remainingMs || timeoutMs, 5000))
      });
    } catch (error) {
      if (!isRetryableChromeConnectError(error)) {
        throw error;
      }

      lastRetryableError = error;
      const nextRemainingMs = deadline - Date.now();
      if (nextRemainingMs <= 0) {
        break;
      }

      if (shouldLog && !hasLoggedRetry) {
        hasLoggedRetry = true;
        log(
          "主线:等待",
          "浏览器引擎",
          "接管会话",
          `调试端口已打开，但 CDP 会话仍未就绪，继续重试：${error.message}`
        );
      }

      await wait(Math.min(connectRetryIntervalMs, nextRemainingMs));
    }
  }

  if (lastRetryableError) {
    throw new Error(
      `调试浏览器连接失败：调试端口已打开，但 ${Math.ceil(timeoutMs / 1000)} 秒内仍未建立 CDP 会话。最后错误：${
        lastRetryableError.message
      }`
    );
  }

  throw new Error("未检测到当前汇总任务的调试浏览器，请重新执行本店汇总。");
}

async function findFirstPage(browser, predicate) {
  // 这里在所有上下文里找目标页面，避免登录后发生跨页跳转导致拿错页面。
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (predicate(page)) {
        return page;
      }
    }
  }

  return null;
}

async function waitForPage(browser, predicate, timeoutMs) {
  // 这里轮询等待目标页面出现，专门兼容用户手工登录和验证码跳转。
  const startAt = Date.now();

  while (Date.now() - startAt <= timeoutMs) {
    const page = await findFirstPage(browser, predicate);
    if (page) {
      return page;
    }

    await wait(1000);
  }

  throw new Error("等待目标页面超时，请确认浏览器里已经完成登录并回到目标页面。");
}

async function disconnectFromChrome(browser, reason = "") {
  // 这里显式只断开 Playwright 连接，不关闭用户当前可见的 Chrome 窗口。
  if (!browser) {
    return;
  }

  const normalizedReason = String(reason || "").trim() || "任务完成，主动断开调试连接";
  if (typeof browser.close === "function") {
    // connectOverCDP 得到的 browser.close 只关闭当前 CDP 会话；不能直接关 _connection，否则会误关同进程里其他并发任务的共享 Playwright 连接。
    await browser.close({ reason: normalizedReason });
  }
}

module.exports = {
  connectToChrome,
  waitForPage,
  disconnectFromChrome
};
