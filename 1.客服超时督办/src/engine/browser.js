const fs = require("fs");
const { chromium } = require("playwright-core");
const appConfig = require("../config/appConfig");
const { resolveLoginEntryUrl, resolveWorkEntryUrl } = require("../config/appRuntimeConfig");
const { log } = require("./logger");
const { waitForReadableBody } = require("./pageReadiness");
const { prepareBrowserRuntimeForLaunch } = require("./browserRuntimeGuard");
const { resolveChromePath } = require("./browserExecutable");

function ensureRuntimeDir() {
  // 这里先创建运行目录，避免首次启动时因为目录不存在直接失败。
  fs.mkdirSync(appConfig.userDataDir, { recursive: true });
  log("主线:准备", "浏览器引擎", "运行目录", `已确认用户数据目录：${appConfig.userDataDir}`);
}

async function launchBrowser(mode) {
  // 这里统一管理持久化浏览器上下文，保证首次登录后的状态能被后续后台启动复用。
  ensureRuntimeDir();
  prepareBrowserRuntimeForLaunch();
  const executablePath = resolveChromePath("浏览器引擎");
  const headless = mode === "run" ? appConfig.runHeadless : false;

  log(
    "主线:启动",
    "浏览器引擎",
    "启动参数",
    `准备启动 Chrome，模式=${mode}，headless=${headless}，说明=${headless ? "无头后台" : "可见独立窗口"}`
  );

  let context;
  try {
    context = await chromium.launchPersistentContext(appConfig.userDataDir, {
      executablePath,
      headless,
      viewport: { width: 1600, height: 900 },
      locale: "zh-CN",
      args: [
        `--profile-directory=${appConfig.runtimeProfileName}`,
        "--disable-blink-features=AutomationControlled",
        "--no-default-browser-check",
        "--disable-popup-blocking",
        `--disk-cache-size=${appConfig.browserDiskCacheSizeBytes}`,
        `--media-cache-size=${appConfig.browserDiskCacheSizeBytes}`
      ]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Target page, context or browser has been closed") ||
      message.includes("exitCode=21")
    ) {
      throw new Error(
        `Chrome 启动失败：运行目录已被其他实例占用。请先关闭现有自动回复窗口或结束旧的 node/chrome 进程，再重新启动。运行目录=${appConfig.userDataDir}`
      );
    }

    throw error;
  }

  context.setDefaultTimeout(appConfig.defaultTimeout);
  return context;
}

async function openLoginEntryPage(context) {
  // 这里首次登录优先打开小蟹账号密码入口，避免基础 /main 入口触发有赞 OAuth 的 redirectUrl 错误。
  const page = context.pages()[0] || (await context.newPage());
  const loginEntryUrl = resolveLoginEntryUrl(appConfig.targetUrl);

  log("主线:执行", "浏览器引擎", "打开登录入口", `准备访问登录入口：${loginEntryUrl}`);
  await navigateToUrl(page, loginEntryUrl, "首次登录");

  log("主线:执行", "浏览器引擎", "登录入口就绪", `当前地址：${page.url()}`);
  return page;
}

async function navigateToTargetPage(page, windowLabel = "") {
  // 这里统一按“跳转完成且正文可读”判断目标页就绪，不再依赖固定毫秒等待。
  await navigateToUrl(page, resolveWorkEntryUrl(appConfig.targetUrl), windowLabel);
}

async function navigateToUrl(page, targetUrl, windowLabel = "") {
  // 这里统一执行页面跳转和正文可读等待，让登录入口和业务入口复用同一套状态判断。
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: appConfig.pageReadyTimeout
  });
  await waitForReadableBody(page, appConfig.pageReadyTimeout);
  if (windowLabel) {
    await applyBrowserWindowIdentity(page, windowLabel);
  }
}

async function applyBrowserWindowIdentity(page, windowLabel) {
  // 这里给受控业务页补清晰标题和红色“督”图标，避免多个 Chrome 窗口堆在一起无法分辨。
  if (typeof page.evaluate !== "function") {
    throw new Error("浏览器窗口标识设置失败：页面对象不支持脚本注入。");
  }

  await page.evaluate((label) => {
    const title = `客服督办｜${label}`;
    document.title = title;

    const iconSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">',
      '<rect width="256" height="256" rx="52" fill="#d9252a"/>',
      '<text x="128" y="166" text-anchor="middle" font-family="Microsoft YaHei, SimHei, sans-serif" font-size="132" font-weight="800" fill="#ffffff">督</text>',
      "</svg>"
    ].join("");
    const iconHref = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg)}`;
    const existingIcon = document.querySelector('link[rel~="icon"]');
    const iconElement = existingIcon || document.createElement("link");
    iconElement.setAttribute("rel", "icon");
    iconElement.setAttribute("href", iconHref);
    if (!existingIcon) {
      document.head.appendChild(iconElement);
    }
  }, windowLabel);
}

module.exports = {
  applyBrowserWindowIdentity,
  launchBrowser,
  openLoginEntryPage,
  navigateToTargetPage,
  navigateToUrl
};
