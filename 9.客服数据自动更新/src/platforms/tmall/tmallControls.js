const appConfig = require("../../config/appConfig");
const { clickLocatorWhenReady } = require("../../shared/browserActionEngine");
// escapeRegex 统一取自 shared/visibleButtonActionEngine 单一真源（#603），勿再复制本地副本。
const { escapeRegex } = require("../../shared/visibleButtonActionEngine");

function buildExactTextPattern(text) {
  // 这里统一把按钮文本收敛成精确匹配，避免“下载记录”“过滤部分时间段”之类的近似文本混进来。
  return new RegExp(`^\\s*${escapeRegex(text)}\\s*$`);
}

function getTmallCurrentDateLocator(page) {
  return page.locator(".oui-date-picker-current-date").first();
}

function getTmallCustomDateButton(page) {
  // 这里统一定位“自定义”入口，后续页面就绪判断和日期点击都共用，避免前后 selector 不一致。
  return page
    .locator("button, a, [role='button']")
    .filter({ hasText: buildExactTextPattern("自定义") })
    .first();
}

async function clickTmallControlWhenReady(locator, controlLabel, timeoutMs = 15000, options = {}) {
  // 这里统一收口天猫页面点击前的状态确认，避免“元素还在抖动就先点了”。
  return clickLocatorWhenReady(locator, controlLabel, {
    timeoutMs,
    pollIntervalMs: appConfig.tmall.actionPollIntervalMs,
    minimumClickIntervalMs: appConfig.tmall.minimumClickIntervalMs,
    requireTrialClick: false,
    ...options
  });
}

module.exports = {
  getTmallCurrentDateLocator,
  getTmallCustomDateButton,
  clickTmallControlWhenReady
};
