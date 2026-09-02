// 该文件用于解决拼多多登录面识别、页面扫描和日志摘要问题。
const appConfig = require("../../../config/appConfig");
const { waitForChromeDebugPortReady } = require("../../../engine/chromeSession");
const { hasPddLoginFormText, isPddBusinessUrl } = require("../pddLoginState");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPddDebugBrowserReady(options = {}) {
  // 这里复用统一调试端口等待引擎，保证拼多多刚开窗时不会抢跑。
  return waitForChromeDebugPortReady({
    timeoutMs: Math.max(1000, Number(options.timeoutMs) || 15000),
    pollIntervalMs: Math.max(50, Number(options.pollIntervalMs) || 300),
    port: appConfig.tmall.remoteDebuggingPort,
    probePort: options.probeDebugPort,
    waitFn: options.waitFn || wait
  });
}

function isCandidatePddLoginPage(url) {
  return isPddBusinessUrl(url) && /login|passport|auth/i.test(String(url || ""));
}

function getSurfaceUrl(surface, fallbackUrl = "") {
  // 这里兼容 Page 和 Frame 两种对象，方便日志直接指出到底是哪一层登录面被识别。
  if (typeof surface?.url === "function") {
    return String(surface.url() || "").trim();
  }

  if (typeof surface?.page === "function") {
    return String(surface.page()?.url?.() || fallbackUrl || "").trim();
  }

  return String(fallbackUrl || "").trim();
}

function normalizeLogPreview(value, maxLength = 120) {
  // 这里压缩页面文本，避免日志被整页文案刷屏，同时保留足够定位证据。
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function isPddLoginSurfaceStateReady(state) {
  // 这里用多证据判断登录界面，而不是只依赖 URL，避免页面已打开但地址或重定向形态变化时漏检。
  return Boolean(
    state &&
      (state.hasLoginFormText ||
        state.hasAccountSwitchText ||
        state.hasAccountInput ||
        state.hasPasswordInput)
  );
}

async function readPddLoginSurfaceState(surface, fallbackUrl = "") {
  // 这里在页面内读取登录面特征，覆盖扫码登录、账号登录切换、账号密码输入框三种状态。
  const surfaceState = await surface.evaluate(() => {
    const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      if (!element) {
        return false;
      }

      const style = window.getComputedStyle(element);
      return Boolean(
        style &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          element.getClientRects().length > 0
      );
    };
    const bodyText = normalizeText(document.body?.innerText || "");
    const visibleControlTexts = Array.from(
      document.querySelectorAll("button,a,span,div,[role='tab'],[role='button']")
    )
      .filter(isVisible)
      .map((element) => normalizeText(element.innerText || element.textContent || ""))
      .filter(Boolean);
    const visibleInputHints = Array.from(document.querySelectorAll("input"))
      .filter(isVisible)
      .map((element) =>
        normalizeText(
          [
            element.getAttribute("type"),
            element.getAttribute("placeholder"),
            element.getAttribute("name"),
            element.getAttribute("id")
          ]
            .filter(Boolean)
            .join(" ")
        )
      )
      .filter(Boolean);

    return {
      bodyText,
      hasAccountSwitchText: visibleControlTexts.some((text) => /账号登录|账户登录|密码登录/i.test(text)),
      hasVisibleLoginAction: visibleControlTexts.some((text) => /^登录$|立即登录|登录拼多多/i.test(text)),
      hasAccountInput: visibleInputHints.some((text) => /账号|手机号|手机号码|phone|mobile|user/i.test(text)),
      hasPasswordInput: visibleInputHints.some((text) => /密码|password/i.test(text)),
      visibleTextPreview: visibleControlTexts.slice(0, 12).join(" | "),
      inputPreview: visibleInputHints.slice(0, 8).join(" | ")
    };
  });

  return {
    ...surfaceState,
    surfaceUrl: getSurfaceUrl(surface, fallbackUrl),
    textPreview: normalizeLogPreview(surfaceState.bodyText),
    visibleTextPreview: normalizeLogPreview(surfaceState.visibleTextPreview),
    inputPreview: normalizeLogPreview(surfaceState.inputPreview),
    hasLoginFormText: hasPddLoginFormText(surfaceState.bodyText)
  };
}

function describePddLoginSurfaceState(state) {
  // 这里把命中的证据翻译成中文日志，后续排查不用再猜是 URL、按钮还是输入框命中。
  const evidence = [];
  if (state?.hasLoginFormText) {
    evidence.push("登录文案");
  }
  if (state?.hasAccountSwitchText) {
    evidence.push("账号登录入口");
  }
  if (state?.hasAccountInput) {
    evidence.push("账号输入框");
  }
  if (state?.hasPasswordInput) {
    evidence.push("密码输入框");
  }
  if (state?.hasVisibleLoginAction) {
    evidence.push("登录按钮");
  }

  return `${evidence.join("+") || "未命中"}，文本=${state?.textPreview || state?.visibleTextPreview || "未读取到"}`;
}

async function collectPddLoginSurfaces(page) {
  // 这里先确认整页属于拼多多商家后台，再从 Page 和 Frame 中收集真正像登录界面的操作面。
  const pageUrl = String(page?.url?.() || "").trim();
  if (!isPddBusinessUrl(pageUrl)) {
    return [];
  }

  const surfaces = [page, ...(typeof page.frames === "function" ? page.frames() : [])];
  const loginSurfaces = [];
  for (const surface of surfaces) {
    const state = await readPddLoginSurfaceState(surface, pageUrl).catch((error) => ({
      surfaceUrl: getSurfaceUrl(surface, pageUrl),
      readError: error instanceof Error ? error.message : String(error)
    }));
    if (isPddLoginSurfaceStateReady(state)) {
      loginSurfaces.push({ surface, state });
    }
  }

  return loginSurfaces;
}

function collectBrowserPageUrls(browser) {
  // 这里只收集 URL 快照用于状态变化日志，避免每轮都输出重复内容。
  const urls = [];
  for (const context of browser?.contexts?.() || []) {
    for (const page of context.pages()) {
      urls.push(String(page.url?.() || "").trim() || "about:blank");
    }
  }

  return urls;
}

function buildBrowserPageScanLog(urls) {
  // 这里把当前 CDP 能看到的页面列出来，直接验证“浏览器是否已经被程序看见”。
  const pddUrls = urls.filter((url) => isPddBusinessUrl(url));
  return `已接管页面数=${urls.length}，拼多多候选页数=${pddUrls.length}，候选页=${pddUrls.map((url) => normalizeLogPreview(url, 180)).join("；") || "暂无"}`;
}

module.exports = {
  wait,
  waitForPddDebugBrowserReady,
  isCandidatePddLoginPage,
  getSurfaceUrl,
  normalizeLogPreview,
  isPddLoginSurfaceStateReady,
  readPddLoginSurfaceState,
  describePddLoginSurfaceState,
  collectPddLoginSurfaces,
  collectBrowserPageUrls,
  buildBrowserPageScanLog
};
