const appConfig = require("../../config/appConfig");
const { waitForPage } = require("../../engine/chromeSession");
const { log } = require("../../engine/logger");
const { ensureTmallActiveStore } = require("./tmallStoreSwitcher");
const { assertNoTmallSafetyChallenge } = require("./tmallSafetyGuard");
const { tryAutofillTmallLoginPage } = require("./tmallLoginAutofill");

// #632：淘宝登录票据 cookie2/_tb_token_ 是会话级，关浏览器即清，导致每次运行都要重新登录。
// 登录确认成功后把它们以持久化副本写回资料目录（等效“记住登录”）；失败只记日志，绝不影响主流程。
const PERSIST_AUTH_COOKIE_NAMES = ["cookie2", "_tb_token_"];
const PERSIST_AUTH_COOKIE_TTL_SECONDS = 7 * 24 * 3600;

async function persistTmallSessionCookies(context) {
  try {
    const cookies = await context.cookies(["https://www.taobao.com", "https://sycm.taobao.com"]);
    const persistUntil = Math.floor(Date.now() / 1000) + PERSIST_AUTH_COOKIE_TTL_SECONDS;
    const seen = new Set();
    const updates = [];
    for (const item of cookies) {
      if (!PERSIST_AUTH_COOKIE_NAMES.includes(item.name)) {
        continue;
      }
      if (item.expires && item.expires > 0) {
        continue;
      }
      const key = `${item.name}|${item.domain}|${item.path}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      updates.push({
        name: item.name,
        value: item.value,
        domain: item.domain,
        path: item.path,
        secure: Boolean(item.secure),
        httpOnly: Boolean(item.httpOnly),
        sameSite: item.sameSite || "Lax",
        expires: persistUntil
      });
    }
    if (!updates.length) {
      return { persisted: 0 };
    }
    await context.addCookies(updates);
    log(
      "主线:完成",
      "天猫登录",
      "登录态持久化",
      `已把 ${updates.map((item) => item.name).join("、")} 续期为持久cookie（7天），下次启动无需重新登录`
    );
    return { persisted: updates.length };
  } catch (error) {
    log(
      "主线:判断",
      "天猫登录",
      "登录态持久化",
      `持久化失败（不影响本次运行，下次仍会自动登录）：${error instanceof Error ? error.message : String(error)}`
    );
    return { persisted: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoginPage(url) {
  return /login|passport|auth/i.test(url || "");
}

function isTmallAuthenticatedBusinessPage(url) {
  // 这个函数只识别已登录的天猫业务域名，允许千牛页作为登录成功凭证。
  return /sycm\.taobao\.com|qn\.taobao\.com/i.test(url || "");
}

async function isTmallLoginReady(page) {
  // 这里用低频结构特征判断登录是否完成，避免反复读取整页正文触发脚本访问风险。
  const url = page.url();
  if (!isTmallAuthenticatedBusinessPage(url)) {
    return false;
  }

  if (isLoginPage(url)) {
    return false;
  }

  const readySelectors = [
    ".oui-date-picker-current-date",
    "a[class*='Frame-module-header']",
    "span[class*='Frame-module-title']"
  ];

  for (const selector of readySelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return true;
    }
  }

  const title = await page.title();
  return /生意参谋|真实体验分|千牛/.test(title);
}

async function confirmTmallLoginReadyPage(page, options = {}) {
  // 这里把登录完成识别和目标店铺校验收口，手动刷新与登录辅助都走同一套事实判断。
  const storeConfig = options.storeConfig || null;
  const phaseText = options.phaseText || "确认天猫登录状态";
  await assertNoTmallSafetyChallenge(page, phaseText);
  if (!(await isTmallLoginReady(page))) {
    return null;
  }

  log("主线:完成", "天猫登录", "状态检测", `已确认登录成功，当前地址=${page.url()}`);
  await persistTmallSessionCookies(page.context());
  let currentShopName = "";
  if (storeConfig && /sycm\.taobao\.com/i.test(page.url())) {
    currentShopName = await ensureTmallActiveStore(page, storeConfig);
  }

  return {
    page,
    currentUrl: page.url(),
    currentShopName
  };
}

async function waitForTmallLoginReady(browser, options = {}) {
  // 这里持续轮询已打开页面，确认登录成功后再按目标店铺做一次强校验，避免后续动作跑错店。
  const storeConfig = options.storeConfig || null;
  await waitForPage(browser, () => true, appConfig.tmall.connectTimeoutMs);
  const startAt = Date.now();
  const deadline = startAt + appConfig.tmall.connectTimeoutMs;
  const autofilledFrames = new WeakSet();

  while (Date.now() <= deadline) {
    let loginSubmitted = false;
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await tryAutofillTmallLoginPage(page, storeConfig, autofilledFrames)) {
          loginSubmitted = true;
          break;
        }
        const readyResult = await confirmTmallLoginReadyPage(page, {
          storeConfig,
          phaseText: "确认天猫登录状态"
        });
        if (readyResult) {
          return readyResult.page;
        }
      }
      if (loginSubmitted) {
        break;
      }
    }

    log(
      "主线:等待",
      "天猫登录",
      "状态检测",
      loginSubmitted ? "登录已提交，等待业务页就绪" : "尚未确认登录成功，继续等待页面状态"
    );
    await wait(Math.min(appConfig.tmall.loginReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error("等待天猫登录成功超时，请确认浏览器里已经完成登录。");
}

module.exports = {
  isTmallLoginReady,
  isTmallAuthenticatedBusinessPage,
  confirmTmallLoginReadyPage,
  persistTmallSessionCookies,
  waitForTmallLoginReady
};
