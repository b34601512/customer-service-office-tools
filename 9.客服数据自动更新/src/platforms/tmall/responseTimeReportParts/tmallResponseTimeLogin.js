// 该文件只负责天猫服务质量报表的入口、登录就绪与店铺身份确认。
const appConfig = require("../../../config/appConfig");
const { log } = require("../../../engine/logger");
const { wait } = require("../../../shared/browserActionEngine");
const { assertNoTmallSafetyChallenge } = require("../tmallSafetyGuard");
const { tryAutofillTmallLoginPage } = require("../tmallLoginAutofill");
const {
  normalizeTmallShopName,
  resolveExpectedTmallShopNames
} = require("../storeSwitcherParts/tmallStoreNameText");
const {
  TMALL_RESPONSE_TIME_REPORT_URL,
  RESPONSE_TIME_LOGIN_READY_TEXTS,
  buildExactTextPattern
} = require("./tmallResponseTimePageElements");

function isTmallResponseTimeReportUrl(url = "") {
  // 这里只识别千牛真实体检分入口和服务体验分析页，避免和生意参谋绩效页混用。
  return /qn\.taobao\.com\/home\.html\/voc-tmall\/serverReport(?:-analysis)?(?:[/?#]|$)/.test(String(url || ""));
}

function isTmallResponseTimeLoginUrl(url = "") {
  // 这里确认已经停在千牛后台业务页，不把登录/授权中转页误判为可操作页面。
  const text = String(url || "");
  return isTmallResponseTimeReportUrl(text) && !/login|passport|auth/i.test(text);
}

function resolveTmallResponseTimeEntranceUrl(reportKey = "response_time") {
  // 实测直接打开 analysis 路由会偶发 ERR_FAILED，统一先开真实体检分首页再按页面入口进入对应明细。
  return TMALL_RESPONSE_TIME_REPORT_URL;
}

async function hasVisibleTmallResponseTimeLoginSignal(page) {
  // 这里只判断千牛后台壳是否已出现，不判断是否已经进入具体报表。
  for (const text of RESPONSE_TIME_LOGIN_READY_TEXTS) {
    const locator = page.getByText(buildExactTextPattern(text)).first();
    if ((await locator.count().catch(() => 0)) > 0 && (await locator.isVisible().catch(() => false))) {
      return true;
    }
  }

  const title = await page.title?.().catch(() => "") || "";
  return /真实体检分|服务体验分析|千牛/.test(title);
}

async function isTmallResponseTimeLoginReadyPage(page) {
  // 这里给登录辅助线程做非阻塞判断，避免平均响应时间页只能依赖手动刷新。
  await assertNoTmallSafetyChallenge(page, "天猫平均响应时间登录检测");
  return isTmallResponseTimeLoginUrl(page.url()) && await hasVisibleTmallResponseTimeLoginSignal(page);
}

function pickTmallResponseTimeCurrentShopName(pageText) {
  // 千牛真实体检分页没有稳定店铺选择器，只能从可见正文中抽取当前顶部店铺名候选。
  const lines = String(pageText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.find((line) => /旗舰店|专营店|店$/.test(line) && !/天猫|店铺|开店|返回/.test(line)) || "";
}

function normalizeTmallVisibleTextForContains(value) {
  // 整页正文可能包含冒号，不能套用店铺名规范化里的“冒号后截断”规则。
  return String(value || "").replace(/\s+/g, "").toLowerCase().trim();
}

async function readTmallResponseTimeShopIdentity(page, storeConfig) {
  // 这里在千牛页用可见文本校验目标店铺，避免错账号登录后继续下载并写错汇总表。
  const expectedShopNames = resolveExpectedTmallShopNames(storeConfig);
  const pageText = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  const normalizedPageText = normalizeTmallVisibleTextForContains(pageText);
  const matchedShopName = expectedShopNames.find((shopName) => {
    const normalizedExpected = normalizeTmallShopName(shopName);
    return normalizedExpected && normalizedPageText.includes(normalizedExpected);
  });
  const currentShopName = matchedShopName || pickTmallResponseTimeCurrentShopName(pageText);

  return {
    expectedShopNames,
    currentShopName,
    matched: Boolean(matchedShopName) || expectedShopNames.length === 0
  };
}

async function tryConfirmTmallResponseTimeLoginReadyPage(page, options = {}) {
  // 这里把千牛页登录完成和店铺身份校验收口，避免平均响应时间链路绕过天猫店铺校验。
  if (!(await isTmallResponseTimeLoginReadyPage(page))) {
    return null;
  }

  const identity = await readTmallResponseTimeShopIdentity(page, options.storeConfig);
  if (identity.matched) {
    return {
      page,
      currentUrl: page.url(),
      currentShopName: identity.currentShopName
    };
  }

  if (identity.currentShopName) {
    throw new Error(
      `天猫店铺身份不一致：当前页面=${identity.currentShopName}，目标=${identity.expectedShopNames.join("、") || "未配置"}。请重新打开该店铺登录窗口并登录正确账号。`
    );
  }

  return null;
}

async function waitForTmallResponseTimeLoginReady(page, timeoutMs = appConfig.tmall.connectTimeoutMs, options = {}) {
  // 这里等待千牛业务壳就绪，后续再按真实点击路径进入平均响应时间。
  const deadline = Date.now() + timeoutMs;
  let pageMatched = false;
  let readySignalVisible = false;
  const autofilledFrames = new WeakSet();

  log("主线:等待", "天猫平均响应时间", "千牛入口就绪", "等待真实体检分/服务体验分析入口出现");
  while (Date.now() <= deadline) {
    const loginSubmitted = await tryAutofillTmallLoginPage(
      page,
      options.storeConfig,
      autofilledFrames
    );
    if (loginSubmitted) {
      log("主线:等待", "天猫平均响应时间", "千牛入口就绪", "登录已提交，等待千牛业务页就绪");
      await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
      continue;
    }
    await assertNoTmallSafetyChallenge(page, "等待天猫平均响应时间千牛入口");
    pageMatched = isTmallResponseTimeLoginUrl(page.url());
    readySignalVisible = await hasVisibleTmallResponseTimeLoginSignal(page);
    if (pageMatched && readySignalVisible) {
      const readyResult = await tryConfirmTmallResponseTimeLoginReadyPage(page, options);
      if (readyResult) {
        log("主线:完成", "天猫平均响应时间", "千牛入口就绪", `当前地址=${page.url()}，当前店铺=${readyResult.currentShopName || "未读到"}`);
        return readyResult;
      }
    }
    await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(
    `等待天猫平均响应时间千牛入口超时：页面地址=${pageMatched ? "已匹配" : page.url()}，入口信号=${readySignalVisible ? "已出现" : "未出现"}。`
  );
}

async function pickTmallResponseTimePage(browser, targetUrl = TMALL_RESPONSE_TIME_REPORT_URL) {
  // 这里复用已经打开的千牛响应时间相关页面，避免新页丢失登录态。
  const contexts = browser.contexts();
  for (const context of contexts) {
    const responsePage = context.pages().find((page) => isTmallResponseTimeReportUrl(page.url()));
    if (responsePage) {
      return responsePage;
    }
  }

  const firstContext = contexts[0];
  const reusablePage =
    firstContext?.pages().find((page) => !/^chrome:|^devtools:/i.test(page.url())) ||
    firstContext?.pages()[0];
  if (reusablePage) {
    return reusablePage;
  }
  if (firstContext && typeof firstContext.newPage === "function") {
    return firstContext.newPage();
  }

  throw new Error(`未找到可用于打开天猫平均响应时间入口的浏览器页：${targetUrl}`);
}

module.exports = {
  isTmallResponseTimeReportUrl,
  resolveTmallResponseTimeEntranceUrl,
  pickTmallResponseTimePage,
  isTmallResponseTimeLoginReadyPage,
  tryConfirmTmallResponseTimeLoginReadyPage,
  waitForTmallResponseTimeLoginReady
};
