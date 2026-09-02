const { log } = require("../../../engine/logger");
const { reportProgress } = require("../downloadTaskParts/jdDownloadProgress");
const {
  resolveRequiredJdSystemMetricLabels,
  findMissingJdMetricLabels
} = require("./jdRequiredMetricRules");
const {
  clickJdSystemIndicatorEditor,
  waitForJdSystemIndicatorDrawer,
  ensureJdMetricCheckedInDrawer,
  saveJdSystemIndicatorDrawer
} = require("./jdIndicatorDrawer");
const { refreshJdSystemReportAfterMetricChange } = require("./jdMetricReportRefresh");

async function readJdRequiredMetricSurfaceText(surface) {
  // 这个函数只读取当前京东报表页面正文用于指标核对。
  return surface.locator("body").innerText({ timeout: 5000 });
}

async function applyMissingJdMetrics(drawer, missingMetricLabels) {
  // 这个函数只逐项勾选缺失指标并汇总变更与不可用状态。
  let hasChanged = false;
  const unavailableMetricLabels = [];
  for (const metricLabel of missingMetricLabels) {
    const metricState = await ensureJdMetricCheckedInDrawer(drawer, metricLabel);
    if (metricState.unavailable) {
      unavailableMetricLabels.push(metricLabel);
      continue;
    }
    hasChanged = metricState.changed || hasChanged;
  }
  return { hasChanged, unavailableMetricLabels };
}

function reportUnavailableJdMetrics(onProgress, missingMetricLabels) {
  // 这个函数只反馈当前店铺缺少且无法提供的指标字段。
  log("主线:跳过", "京东系统下载", "指标列校验", `当前店铺没有字段=${missingMetricLabels.join("、")}，后续导入对应子表时跳过`);
  reportProgress(onProgress, "跳过缺失指标", `当前店铺没有字段=${missingMetricLabels.join("、")}，对应子表不写入`);
}

async function ensureJdSystemRequiredMetricsVisible({ surface, resolvedConfig, exportRange, onProgress = null }) {
  // 这个函数只按固定顺序保证导出页面包含当前报表必选指标。
  const requiredMetricLabels = resolveRequiredJdSystemMetricLabels(resolvedConfig);
  if (!requiredMetricLabels.length) {
    return;
  }
  let missingMetricLabels = findMissingJdMetricLabels(
    await readJdRequiredMetricSurfaceText(surface),
    requiredMetricLabels
  );
  if (!missingMetricLabels.length) {
    log("主线:完成", "京东系统下载", "指标列校验", `已看到目标列=${requiredMetricLabels.join("、")}`);
    return;
  }
  reportProgress(onProgress, "校验指标列", `缺少=${missingMetricLabels.join("、")}，准备打开编辑指标`);
  await clickJdSystemIndicatorEditor(surface);
  const drawer = await waitForJdSystemIndicatorDrawer(surface);
  const { hasChanged, unavailableMetricLabels } = await applyMissingJdMetrics(drawer, missingMetricLabels);
  if (hasChanged || unavailableMetricLabels.length) {
    await saveJdSystemIndicatorDrawer(drawer);
  }
  if (hasChanged) {
    await refreshJdSystemReportAfterMetricChange(surface, exportRange);
  }
  missingMetricLabels = findMissingJdMetricLabels(
    await readJdRequiredMetricSurfaceText(surface),
    requiredMetricLabels
  );
  if (missingMetricLabels.length) {
    reportUnavailableJdMetrics(onProgress, missingMetricLabels);
    return;
  }
  const unavailableText = unavailableMetricLabels.length ? `，平台未提供=${unavailableMetricLabels.join("、")}` : "";
  log("主线:完成", "京东系统下载", "指标列校验", `已补齐目标列=${requiredMetricLabels.join("、")}${unavailableText}`);
}

module.exports = {
  ensureJdSystemRequiredMetricsVisible
};
