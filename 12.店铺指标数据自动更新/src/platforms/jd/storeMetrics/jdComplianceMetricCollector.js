const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const { formatDate } = require("../../../config/storeMetricConfig");
const {
  waitForJdMetricPageText
} = require("./jdMetricText");
const { escapeRegExp } = require("../../../shared/escapeRegExp");

async function readVisibleComplianceCardValue(page, metricLabel) {
  const deadline = Date.now() + 30000;
  let stableValue = null;
  let stableReadCount = 0;
  await page.waitForTimeout(1500);
  while (Date.now() <= deadline) {
    const metricTitleElements = page.locator(".guide-item-title").filter({
      hasText: new RegExp(`^${escapeRegExp(metricLabel)}$`)
    });
    const elementCount = await metricTitleElements.count().catch(() => 0);
    let currentValue = null;
    for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
      const titleElement = metricTitleElements.nth(elementIndex);
      if (!(await titleElement.isVisible().catch(() => false))) continue;
      currentValue = await titleElement.evaluate((element, label) => {
        const cardElement = element.closest(".guide-item") || element.parentElement;
        const cardText = String(cardElement?.innerText || cardElement?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        const labelOffset = cardText.indexOf(label);
        if (labelOffset < 0) return null;
        const numericMatch = cardText.slice(labelOffset + label.length).match(/([0-9][0-9,]*)/);
        return numericMatch ? Number(numericMatch[1].replace(/,/g, "")) : null;
      }, metricLabel);
      if (Number.isFinite(currentValue)) break;
    }
    if (Number.isFinite(currentValue) && currentValue === stableValue) {
      stableReadCount += 1;
    } else {
      stableValue = currentValue;
      stableReadCount = Number.isFinite(currentValue) ? 1 : 0;
    }
    if (stableReadCount >= 3) return stableValue;
    await page.waitForTimeout(400);
  }
  // 超时读不到稳定数值（如页面该卡片暂无数据）返回 null，由收集器跳过该项而不是整店判失败。
  return null;
}

async function collectJdComplianceMetrics(page, store) {
  await page.goto(store.sources.compliance, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForJdMetricPageText(page, ["合规健康度", "待处理预警单"]);
  const dataDate = formatDate(new Date());
  const collectedAt = new Date().toISOString();
  const definitions = [
    "待处理预警单",
    "待处理违约单",
    "待处理信息违规"
  ];
  const records = [];
  const skipped = [];
  for (const metricName of definitions) {
    const metricValue = await readVisibleComplianceCardValue(page, metricName);
    if (metricValue === null) {
      skipped.push(metricName);
      continue;
    }
    records.push(createStoreMetricRecord({
      platform: "京东",
      storeKey: store.key,
      storeName: store.displayName,
      dataDate,
      statisticsStartDate: dataDate,
      statisticsEndDate: dataDate,
      metricName,
      metricValue,
      unit: "项",
      originalStatisticsWindow: "当前待处理快照",
      sourcePage: "店铺合规",
      sourceUrl: store.sources.compliance,
      sourceOriginalMetricName: metricName,
      collectedAt
    }));
  }
  return { records, skipped };
}

module.exports = {
  collectJdComplianceMetrics,
  readVisibleComplianceCardValue
};
