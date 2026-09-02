const appConfig = require("../../../config/appConfig");
const {
  isDouyinLoginUrl,
  isDouyinLoginRequiredText,
  readDouyinPageText
} = require("../douyinLoginRecovery");

class DouyinLoginRequiredError extends Error {
  constructor(message = "抖音登录已过期，需要恢复登录。") {
    super(message);
    this.name = "DouyinLoginRequiredError";
    this.code = "DOUYIN_LOGIN_REQUIRED";
  }
}

function isDouyinExperienceScoreUrl(url) {
  return /fxg\.jinritemai\.com\/ffa\/eco\/experience-score/i.test(String(url || ""));
}

async function navigateDouyinExperienceScorePage(page, targetUrl, attempts = 3) {
  let lastError = null;
  for (let attemptIndex = 1; attemptIndex <= attempts; attemptIndex += 1) {
    try {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: appConfig.douyin.connectTimeoutMs });
      return;
    } catch (error) {
      if (!/net::ERR_ABORTED/i.test(String(error?.message || error))) throw error;
      if (isDouyinExperienceScoreUrl(page.url())) return;
      lastError = error;
      if (attemptIndex < attempts) await page.waitForTimeout(800);
    }
  }
  throw new Error(`抖音服务体验页面连续${attempts}次导航被中断：${lastError?.message || "ERR_ABORTED"}`);
}

function isDouyinExperienceScoreContentReady(pageText) {
  const normalizedText = String(pageText || "").replace(/\s+/g, " ").trim();
  // 只凭“服务体验得分”等概览文案 + 页面底部“规则中心”的考核说明标题（如
  // “飞鸽平均响应时长考核说明”）会被误判为就绪，但此时详情表格还没渲染，
  // 解析只能拿到 2 条概览指标。这里额外要求各详情考核表（查看详情 + 数值单位）
  // 真实出现在页面上，服务体验与差行为两个页签都渲染完成后才返回就绪。
  return /服务体验得分\s*\d+(?:\.\d+)?\s*分/.test(normalizedText) &&
    /飞鸽平均响应时长\s*查看详情[\s\S]{0,200}?\d+(?:\.\d+)?\s*秒/.test(normalizedText) &&
    /售后平均审核时长\s*查看详情[\s\S]{0,200}?\d+(?:\.\d+)?\s*小时/.test(normalizedText) &&
    /平台求助率\s*查看详情[\s\S]{0,200}?\d+(?:\.\d+)?\s*%/.test(normalizedText) &&
    /虚假交易刷体验分[\s\S]{0,200}?\d+\s*次/.test(normalizedText) &&
    /影响消费者体验[\s\S]{0,200}?\d+\s*次/.test(normalizedText);
}

async function waitForDouyinExperienceScoreReady(page, timeoutMs = appConfig.douyin.connectTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latestText = "";
  while (Date.now() <= deadline) {
    if (isDouyinLoginUrl(page.url())) throw new DouyinLoginRequiredError();
    latestText = await readDouyinPageText(page);
    if (isDouyinLoginRequiredText(latestText)) throw new DouyinLoginRequiredError();
    if (isDouyinExperienceScoreContentReady(latestText)) return latestText;
    await page.waitForTimeout(Math.min(appConfig.douyin.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`等待抖音服务体验页面超时，当前页面文本=${latestText.replace(/\s+/g, " ").slice(0, 160)}`);
}

module.exports = {
  DouyinLoginRequiredError,
  isDouyinExperienceScoreUrl,
  navigateDouyinExperienceScorePage,
  readDouyinPageText,
  isDouyinExperienceScoreContentReady,
  waitForDouyinExperienceScoreReady
};
