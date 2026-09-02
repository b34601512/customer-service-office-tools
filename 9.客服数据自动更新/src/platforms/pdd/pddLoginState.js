const { isPddStoreIdentityMatched } = require("./pddStoreIdentity");
const { isPddPageLoadingText, readPddPageBodyText } = require("./pddPageText");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

const PDD_LOGIN_READY_POLL_INTERVAL_MS = 2000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNextPddLoginCheck(deadlineMs, pollIntervalMs = PDD_LOGIN_READY_POLL_INTERVAL_MS) {
  // 这里让拼多多登录态检查保持低频，同时不超过调用方给定的剩余超时时间。
  const remainingMs = Math.max(0, Number(deadlineMs) - Date.now());
  if (remainingMs <= 0) {
    return;
  }

  await wait(Math.min(Math.max(1, Number(pollIntervalMs) || PDD_LOGIN_READY_POLL_INTERVAL_MS), remainingMs));
}

function isPddBusinessUrl(url) {
  // 这里只认拼多多商家后台域名，避免把其他平台页面当成本任务登录成功。
  return /mms\.pinduoduo\.com/i.test(String(url || ""));
}

function pickPddPageScore(page, storeConfig = {}) {
  const url = String(page?.url?.() || "");
  if (!isPddBusinessUrl(url)) {
    return 0;
  }

  const targetUrl = String(storeConfig?.siteUrl || "").trim();
  if (targetUrl && url.startsWith(targetUrl)) {
    return 30;
  }
  if (/mms-chat|客服|merchant/i.test(url)) {
    return 20;
  }
  return 10;
}

function findBestPddPage(browser, storeConfig = {}) {
  // 这里在所有页面里挑最像当前拼多多后台的页面，避免浏览器里多个标签时误读。
  const candidates = [];
  for (const context of browser?.contexts?.() || []) {
    for (const page of context.pages()) {
      const score = pickPddPageScore(page, storeConfig);
      if (score > 0) {
        candidates.push({ page, score });
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0]?.page || null;
}

function hasPddLoginFormText(text) {
  const normalizedText = normalizeText(text);
  return [
    "手机号登录",
    "账号登录",
    "扫码登录",
    "请输入手机号",
    "请输入账号",
    "请输入密码",
    "登录拼多多",
    "立即登录"
  ].some((keyword) => normalizedText.includes(keyword));
}

function hasPddBusinessReadyText(text) {
  const normalizedText = normalizeText(text);
  return [
    "客服数据",
    "客服绩效",
    "客服销售额",
    "基础数据",
    "下载表单",
    "商家后台"
  ].some((keyword) => normalizedText.includes(keyword));
}

function hasPddStrongBusinessReadyText(text) {
  const normalizedText = normalizeText(text);
  return [
    "多多客服",
    "客服数据",
    "客服绩效",
    "客服销售额",
    "基础数据",
    "下载表单",
    "今日客服总成交金额"
  ].some((keyword) => normalizedText.includes(keyword));
}

function isPddLoginReadyState(pageUrl, bodyText, storeConfig = {}) {
  // 页面仍显示加载中时一律未就绪；只有稳定正文才允许判定登录和店铺身份。
  if (!isPddBusinessUrl(pageUrl)) {
    return false;
  }

  if (isPddPageLoadingText(bodyText)) {
    return false;
  }

  if (hasPddStrongBusinessReadyText(bodyText)) {
    return isPddStoreIdentityMatched(bodyText, storeConfig);
  }

  if (hasPddLoginFormText(bodyText)) {
    return false;
  }

  const targetUrl = String(storeConfig?.siteUrl || "").trim();
  const hasReadySignal = hasPddBusinessReadyText(bodyText) || (targetUrl && String(pageUrl || "").startsWith(targetUrl));
  return Boolean(hasReadySignal && isPddStoreIdentityMatched(bodyText, storeConfig));
}

async function isPddLoginReadyPage(page, storeConfig = {}) {
  // 读取一次页面正文后交给纯判定函数，页面读取失败必须直接暴露。
  if (!page) {
    return false;
  }
  const pageUrl = page.url();
  if (!isPddBusinessUrl(pageUrl)) {
    return false;
  }
  return isPddLoginReadyState(pageUrl, await readPddPageBodyText(page), storeConfig);
}

async function findPddLoginReadyPage(browser, options = {}) {
  // 在限定时间内查询登录就绪页，正常未就绪返回 null，真实页面错误直接抛出。
  const storeConfig = options.storeConfig || {};
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || 15000);
  const pollIntervalMs = Number(options.pollIntervalMs) || PDD_LOGIN_READY_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const page = findBestPddPage(browser, storeConfig);
    if (page && (await isPddLoginReadyPage(page, storeConfig))) {
      return page;
    }

    await waitForNextPddLoginCheck(deadline, pollIntervalMs);
  }

  return null;
}

async function waitForPddLoginReady(browser, options = {}) {
  // 强制登录入口只负责把正常未就绪结果转换成用户可理解的中文错误。
  const readyPage = await findPddLoginReadyPage(browser, options);
  if (!readyPage) {
    throw new Error("未确认拼多多登录成功。请在打开的拼多多窗口完成登录，并回到商家后台页面后再刷新。");
  }
  return readyPage;
}

module.exports = {
  isPddBusinessUrl,
  findBestPddPage,
  hasPddLoginFormText,
  isPddLoginReadyState,
  isPddLoginReadyPage,
  findPddLoginReadyPage,
  waitForPddLoginReady
};
