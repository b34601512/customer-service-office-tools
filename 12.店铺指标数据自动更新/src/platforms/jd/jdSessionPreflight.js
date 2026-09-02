// 该文件用于解决京东汇总前登录态失效时自动推进普通登录流程的问题。
const { log } = require("../../engine/logger");
const {
  collectJdPageSurfaces,
  hasJdLoginFormText,
  hasJdSessionExpiredText,
  isJdLoginReady,
  isJdPassportLoginUrl,
  isJdSystemUrl
} = require("./jdLoginPageClassifier");
const { tryAutofillLoginFrame } = require("./loginSurfaceParts/jdLoginAutofill");
const { tryClickExpiredSessionDialog, tryClickLoginEntry } = require("./loginSurfaceParts/jdLoginEntryActions");
const { waitForDynamicLoginSurface, waitForLoginTransition } = require("./loginSurfaceParts/jdLoginSurfaceState");
const { redirectJdNoAccessToLogin } = require("./jdNoAccessLoginRedirect");
const { readJdPageBodyText } = require("./jdPageText");

function isJdSessionPreflightUrl(url) {
  // 这里只接管京东系统和官方登录页面，避免误操作用户浏览器里的无关网页。
  return /passport\.jd\.com|passport\.shop\.jd\.com|xi\.jd\.com|kf\.jd\.com/i.test(
    String(url || "")
  );
}

function collectJdSessionPages(browser) {
  // 这里只收集当前调试浏览器里的京东相关页面，后续每页独立推进。
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => page && !(typeof page.isClosed === "function" && page.isClosed()))
    .filter((page) => isJdSessionPreflightUrl(page.url()));
}

async function readJdPreflightPageText(page) {
  // 这里读取页面正文用于判断是否已过期或已经进入登录表单。
  return String(await readJdPageBodyText(page))
    .replace(/\s+/g, " ")
    .trim();
}

async function tryClickJdExpiredDialog(page, displayName) {
  // 这里优先点击“登录已过期”的主按钮，让流程回到普通登录链路。
  for (const surface of collectJdPageSurfaces(page)) {
    const clickResult = await tryClickExpiredSessionDialog(surface);
    if (clickResult?.clicked) {
      log("主线:完成", "京东登录", "过期弹窗", `店铺「${displayName}」已点击过期弹窗登录按钮`);
      await waitForLoginTransition(page, 3000);
      return true;
    }
  }

  return false;
}

async function tryAutofillJdLoginPage(page, credentials, displayName) {
  // 这里只处理普通账号密码登录，验证码和滑块仍然停给人工完成。
  if (!credentials?.username || !credentials?.password) {
    return false;
  }

  const loginSurfaceReady = await waitForDynamicLoginSurface(page, 500);
  if (!loginSurfaceReady) {
    return false;
  }

  for (const surface of collectJdPageSurfaces(page)) {
    const filled = await tryAutofillLoginFrame(surface, credentials);
    if (filled) {
      log("主线:完成", "京东登录", "自动填充", `店铺「${displayName}」账号密码已写入，并已尝试点击登录按钮`);
      return true;
    }
  }

  return false;
}

async function tryClickJdLoginEntry(page, displayName) {
  // 这里从业务页或欢迎页点击普通登录入口，后续再识别登录表单。
  if (isJdPassportLoginUrl(page.url())) {
    return false;
  }

  for (const surface of collectJdPageSurfaces(page)) {
    const clicked = await tryClickLoginEntry(surface);
    if (clicked) {
      log("主线:完成", "京东登录", "自动点击", `店铺「${displayName}」已点击登录入口`);
      await waitForLoginTransition(page, 3000);
      return true;
    }
  }

  return false;
}

async function advanceJdSessionPage(page, storeConfig = {}) {
  // 这里把单个京东页面推进一步：过期弹窗、登录入口、账号密码登录三者只做当前可做的一步。
  if (await redirectJdNoAccessToLogin(page, storeConfig)) {
    return true;
  }

  if (await isJdLoginReady(page)) {
    return false;
  }

  const displayName = String(storeConfig.displayName || storeConfig.key || "当前店铺");
  const pageText = await readJdPreflightPageText(page);
  if (hasJdSessionExpiredText(pageText) || (await tryClickJdExpiredDialog(page, displayName))) {
    if (!hasJdSessionExpiredText(pageText)) {
      return true;
    }

    const clicked = await tryClickJdExpiredDialog(page, displayName);
    return clicked;
  }

  const credentials = {
    username: storeConfig.username,
    password: storeConfig.password
  };
  if (isJdPassportLoginUrl(page.url()) || hasJdLoginFormText(pageText)) {
    return await tryAutofillJdLoginPage(page, credentials, displayName);
  }

  if (isJdSystemUrl(page.url())) {
    // 系统业务页只有“目标页”这一种合法终点；普通业务文字永远不能被当成登录入口。
    return false;
  }

  return await tryClickJdLoginEntry(page, displayName);
}

async function advanceJdSessionBeforeReadyCheck(browser, storeConfig = {}) {
  // 这里在“等待已登录”前先尝试推进普通登录状态，避免失效页一直等到超时。
  for (const page of collectJdSessionPages(browser)) {
    const advanced = await advanceJdSessionPage(page, storeConfig);
    if (advanced) {
      return true;
    }
  }

  return false;
}

module.exports = {
  advanceJdSessionBeforeReadyCheck,
  advanceJdSessionPage
};
