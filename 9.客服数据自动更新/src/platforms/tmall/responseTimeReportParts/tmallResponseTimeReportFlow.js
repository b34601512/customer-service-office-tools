// 该文件只负责进入天猫服务体验分析并等待目标报表就绪。
const appConfig = require("../../../config/appConfig");
const { log } = require("../../../engine/logger");
const { wait, waitForLocatorActionable, clickLocatorWhenReady } = require("../../../shared/browserActionEngine");
const { assertNoTmallSafetyChallenge } = require("../tmallSafetyGuard");
const {
  RESPONSE_TIME_METRIC_TEXT,
  RESPONSE_TIME_RESULT_COLUMN_TEXT,
  getTmallServiceExperienceAnalysisEntry,
  getTmallResponseTimeMetricEntry,
  getTmallResponseTimeDataSignal,
  getTmallResponseTimeExportButton,
  getTmallCustomerSatisfactionDetailButton,
  hasVisibleClickableText
} = require("./tmallResponseTimePageElements");
const { waitForTmallResponseTimeLoginReady } = require("./tmallResponseTimeLogin");

/** 报表表头卡住时最多再试几次（有界，防死循环） */
const 报表最大尝试次数 = 2;

async function waitForTmallServiceExperienceReady(page, timeoutMs = appConfig.tmall.connectTimeoutMs) {
  // 这里等待服务体验分析页内部的平均响应时间入口出现。
  const deadline = Date.now() + timeoutMs;
  let metricVisible = false;

  log("主线:等待", "天猫平均响应时间", "服务体验分析就绪", "等待旺旺人工平响时长入口出现");
  while (Date.now() <= deadline) {
    await assertNoTmallSafetyChallenge(page, "等待服务体验分析入口");
    metricVisible = await hasVisibleClickableText(page, RESPONSE_TIME_METRIC_TEXT);
    if (metricVisible) {
      log("主线:完成", "天猫平均响应时间", "服务体验分析就绪", `当前地址=${page.url()}`);
      return;
    }
    await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(`等待服务体验分析就绪超时：${RESPONSE_TIME_METRIC_TEXT}=${metricVisible ? "已出现" : "未出现"}。`);
}

async function waitForTmallAverageResponseTimeReady(page, timeoutMs = appConfig.tmall.connectTimeoutMs) {
  // 这里等待真正的平均响应时间数据页就绪，避免停在服务体验分析默认指标时误导出。
  const deadline = Date.now() + timeoutMs;
  const dataSignal = getTmallResponseTimeDataSignal(page);
  const exportButton = getTmallResponseTimeExportButton(page);
  let dataSignalVisible = false;
  let exportVisible = false;

  log("主线:等待", "天猫平均响应时间", "报表就绪", "等待平均响应时长表头和导出按钮出现");
  while (Date.now() <= deadline) {
    await assertNoTmallSafetyChallenge(page, "等待平均响应时间报表");
    dataSignalVisible = await dataSignal.isVisible().catch(() => false);
    exportVisible = await exportButton.isVisible().catch(() => false);
    if (dataSignalVisible && exportVisible) {
      log("主线:完成", "天猫平均响应时间", "报表就绪", `当前地址=${page.url()}`);
      return;
    }
    await wait(Math.min(appConfig.tmall.pageReadyPollIntervalMs, Math.max(1, deadline - Date.now())));
  }

  throw new Error(
    `等待平均响应时间报表就绪超时：${RESPONSE_TIME_RESULT_COLUMN_TEXT}=${dataSignalVisible ? "已出现" : "未出现"}，导出按钮=${exportVisible ? "已出现" : "未出现"}。`
  );
}

async function clickTmallServiceExperienceAnalysis(page, options = {}) {
  // 这里先进入服务体验分析，不能直接尝试打开平均响应时间报表。
  const analysisEntry = await getTmallServiceExperienceAnalysisEntry(page);
  await clickLocatorWhenReady(analysisEntry, "服务体验分析入口", buildResponseTimeClickOptions(options));
}

async function clickTmallAverageResponseTimeEntry(page, options = {}) {
  // 这里从服务体验分析内部进入旺旺人工平响时长报表。
  const metricEntry = await getTmallResponseTimeMetricEntry(page);
  await clickLocatorWhenReady(metricEntry, "旺旺人工平响时长入口", buildResponseTimeClickOptions(options));
}

async function clickTmallResponseTimeExport(page, options = {}) {
  // 这里在平均响应时间报表就绪后触发导出。
  const exportButton = getTmallResponseTimeExportButton(page);
  await clickLocatorWhenReady(exportButton, "平均响应时间导出按钮", buildResponseTimeClickOptions(options));
}

async function waitForTmallCustomerSatisfactionDetailReady(page, options = {}) {
  // 客户满意度必须等到真正要点击的明细入口出现，页头出现不代表指标已经加载完成。
  const actionName = "旺旺满意度明细入口";
  const timeoutMs = options.timeoutMs || appConfig.tmall.connectTimeoutMs;
  const detailButton = getTmallCustomerSatisfactionDetailButton(page);
  log("主线:等待", "天猫客户满意度", "明细就绪", "等待旺旺满意度明细入口出现");
  await waitForLocatorActionable(detailButton, actionName, {
    ...buildResponseTimeClickOptions(options),
    timeoutMs
  });
  log("主线:完成", "天猫客户满意度", "明细就绪", "旺旺满意度明细入口已出现");
}

function buildResponseTimeClickOptions(options = {}) {
  // 这里统一平均响应时间点击节奏，生产环境慢点击，测试环境可关闭间隔。
  return {
    timeoutMs: Number(options.timeoutMs) || 30000,
    pollIntervalMs: Number(options.pollIntervalMs) || appConfig.tmall.actionPollIntervalMs,
    minimumClickIntervalMs: Object.prototype.hasOwnProperty.call(options, "minimumClickIntervalMs")
      ? Number(options.minimumClickIntervalMs) || 0
      : appConfig.tmall.minimumClickIntervalMs,
    requireTrialClick: false,
    shouldLogThrottle: options.shouldLogThrottle
  };
}

async function prepareTmallResponseTimeExportPage(page, options = {}) {
  // 这里收口真实业务路径：千牛入口 -> 服务体验分析 -> 旺旺人工平响时长。
  // 2026-09-17 增：表头一直停在“加载中…”（接口彽发失败）时，回到入口重走一次（有界，防死循环）。
  const timeoutMs = options.timeoutMs || appConfig.tmall.connectTimeoutMs;
  await waitForTmallResponseTimeLoginReady(page, timeoutMs, options);
  await clickTmallServiceExperienceAnalysis(page, options);
  await waitForTmallServiceExperienceReady(page, timeoutMs);
  await 带重试地打开平均响应时间报表({
    打开一次: async () => {
      await clickTmallAverageResponseTimeEntry(page, options);
      await waitForTmallAverageResponseTimeReady(page, timeoutMs);
    },
    回到入口: () => 回到千牛入口并重进服务体验分析(page, options, timeoutMs),
    最大尝试次数: Number(options.报表尝试次数) || 报表最大尝试次数,
  });
}

/** 报表表头卡住时的回归路径：重新打开入口地址（拿不到就刷新）再走一遍服务体验分析 */
async function 回到千牛入口并重进服务体验分析(page, options, timeoutMs) {
  const entranceUrl = String(options.entranceUrl || "").trim();
  if (entranceUrl) {
    log("主线:重试", "天猫平均响应时间", "报表加载重试", `重新打开入口地址=${entranceUrl}`);
    await page.goto(entranceUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } else {
    log("主线:重试", "天猫平均响应时间", "报表加载重试", "未拿到入口地址，改为刷新当前页面");
    await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  }
  await waitForTmallResponseTimeLoginReady(page, timeoutMs, options);
  await clickTmallServiceExperienceAnalysis(page, options);
  await waitForTmallServiceExperienceReady(page, timeoutMs);
}

/** 有界重试：最多试 最大尝试次数 次，每次失败后先跑一次「回到入口」 */
async function 带重试地打开平均响应时间报表({ 打开一次, 回到入口, 最大尝试次数 = 报表最大尝试次数 }) {
  // 尝试次数必须有限且为正整数，非法值一律回落默认值，避免退化成死循环
  const 次数 = Number(最大尝试次数) > 0 ? Math.floor(Number(最大尝试次数)) : 报表最大尝试次数;
  let 最后一次错误 = null;
  for (let 尝试 = 1; 尝试 <= 次数; 尝试 += 1) {
    try {
      await 打开一次();
      if (尝试 > 1) log("主线:完成", "天猫平均响应时间", "报表加载重试", `第 ${尝试} 次尝试已就绪`);
      return;
    } catch (错误) {
      最后一次错误 = 错误;
      if (尝试 >= 次数) break;
      log(
        "主线:重试",
        "天猫平均响应时间",
        "报表加载重试",
        `第 ${尝试} 次未就绪，准备回到入口重试：${错误 && 错误.message ? 错误.message : 错误}`
      );
      await 回到入口();
    }
  }
  throw 最后一次错误 instanceof Error ? 最后一次错误 : new Error(String(最后一次错误 || "平均响应时间报表未就绪"));
}

module.exports = {
  buildResponseTimeClickOptions,
  clickTmallResponseTimeExport,
  waitForTmallCustomerSatisfactionDetailReady,
  prepareTmallResponseTimeExportPage,
  带重试地打开平均响应时间报表
};
