const appConfig = require("../../../config/appConfig");
const {
  isDouyinLoginUrl,
  isDouyinLoginRequiredText,
  readDouyinPageText
} = require("../douyinLoginRecovery");
const { checkBrowserHumanRequirement } = require("../../../engine/browserHumanGuard");
const { requireHeadedBrowser } = require("../../../engine/browserAutomationScope");

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
  const legacyLayoutReady = /服务体验得分\s*\d+(?:\.\d+)?\s*分/.test(normalizedText) &&
    /飞鸽平均响应时长\s*查看详情[\s\S]{0,200}?\d+(?:\.\d+)?\s*秒/.test(normalizedText) &&
    /售后平均审核时长\s*查看详情[\s\S]{0,200}?\d+(?:\.\d+)?\s*小时/.test(normalizedText) &&
    /平台求助率\s*查看详情[\s\S]{0,200}?\d+(?:\.\d+)?\s*%/.test(normalizedText) &&
    /虚假交易刷体验分[\s\S]{0,200}?\d+\s*次/.test(normalizedText) &&
    /影响消费者体验[\s\S]{0,200}?\d+\s*次/.test(normalizedText);
  if (legacyLayoutReady) return true;

  // 抖音新版页面改成“体验分概览 + 指标卡片”，不再出现旧版的“查看详情”文案。
  // 以页面自身的更新时间、总分和至少三个详情卡片标题作为就绪依据，避免只
  // 看到规则中心标题就提前解析；卡片值允许为 0 或暂无数据，后续解析会把缺失值记为 0。
  const currentLayoutLabels = [
    "商品综合评分",
    "商品品质退货率",
    "平均揽收时长",
    "运单配送时效达成率",
    "飞鸽人工会话平响时长",
    "售后平均审核时长",
    "飞鸽人工会话不满意率",
    "平台求助率"
  ];
  const currentLayoutLabelCount = currentLayoutLabels.filter((label) => normalizedText.includes(label)).length;
  return /体验分概览/.test(normalizedText) &&
    /更新时间\s*[:：]?\s*[^\s，。,；;]+/.test(normalizedText) &&
    /我的总分/.test(normalizedText) &&
    /服务体验/.test(normalizedText) &&
    currentLayoutLabelCount >= 3;
}

async function waitForDouyinExperienceScoreReady(page, timeoutMs = appConfig.douyin.connectTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latestText = "";
  while (Date.now() <= deadline) {
    await checkBrowserHumanRequirement({ includeLogin: true });
    if (isDouyinLoginUrl(page.url())) {
      requireHeadedBrowser("抖音登录已失效");
      throw new DouyinLoginRequiredError();
    }
    latestText = await readDouyinPageText(page);
    if (isDouyinLoginRequiredText(latestText)) {
      requireHeadedBrowser("抖音登录已失效");
      throw new DouyinLoginRequiredError();
    }
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
