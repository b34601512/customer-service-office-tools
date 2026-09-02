const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseStatisticsDateRange,
  extractMetricFromText,
  readMetricValue
} = require("../src/platforms/jd/storeMetrics/jdMetricText");

const logisticsText = "核心指标 指标统计存在延迟，当前统计 2026-07-01 至 2026-07-25 期间数据。延迟发货率 0.14%";

test("读取违规服务分析真实统计区间", () => {
  assert.deepEqual(parseStatisticsDateRange(logisticsText), {
    startDate: "2026-07-01",
    endDate: "2026-07-25"
  });
});

test("读取延迟发货率页面数值", () => {
  assert.equal(extractMetricFromText(logisticsText, "延迟发货率", "%"), 0.14);
});

test("读取店铺星级页面展示的两个明细评分", () => {
  const shopStarText = "售后服务时长 8.0分 指标表现 12.215小时 平台介入率 10.0分 指标表现 0.22148%";
  assert.equal(extractMetricFromText(shopStarText, "售后服务时长", "分"), 8);
  assert.equal(extractMetricFromText(shopStarText, "平台介入率", "分"), 10);
});

test("页面缺少该指标时提取数值返回 null", () => {
  assert.equal(extractMetricFromText(logisticsText, "工单24小时完结率", "%"), null);
});

test("指标数值读不到时返回 null 而非抛错", async () => {
  const fakePage = { evaluate: async () => null };
  assert.equal(await readMetricValue(fakePage, logisticsText, "工单24小时完结率", "%"), null);
});
