const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveWindowDates,
  listBasicIndicatorMetrics,
  listShopStarIndicatorScoreMetrics,
  listSummaryMetrics,
  listServiceProductMetrics
} = require("../src/platforms/jd/storeMetrics/jdShopStarMetricCollector");

test("近30天窗口包含数据日期当天", () => {
  assert.deepEqual(resolveWindowDates("2026-07-31", "近30天"), {
    startDate: "2026-07-02",
    endDate: "2026-07-31"
  });
});

test("店铺星级接口原值按单位正确转换", () => {
  const basicData = {
    finalScore: 9.95,
    validOrderNum: "1767",
    serviceBonus: 0.4,
    zbs: {
      Vane_ScoreRankRate: { pji: "5.0", rank: 86.9 },
      Vane_ResponseSpeed: { pfen: "11.91" },
      Vane_IntervOrigin: { pfen: "0.22148" }
    },
    serviceProducts: [{ name: "店铺复购率", status: "4.38" }]
  };
  const starsData = {
    customServiceConsultScore: "10.0",
    logisticsLvyueScore: "9.8",
    afterServiceScore: "9.3",
    userEvaluateScore: "8.8"
  };
  const allMetrics = [
    ...listSummaryMetrics(basicData, starsData),
    ...listBasicIndicatorMetrics(basicData).definitions,
    ...listServiceProductMetrics(basicData)
  ];
  assert.ok(Math.abs(allMetrics.find((metric) => metric.metricName === "店铺星级排名").metricValue - 0.869) < 1e-12);
  assert.ok(Math.abs(allMetrics.find((metric) => metric.metricName === "平台介入率（店铺星级）").metricValue - 0.0022148) < 1e-12);
  assert.ok(Math.abs(allMetrics.find((metric) => metric.metricName === "店铺复购率").metricValue - 0.0438) < 1e-12);
});

test("店铺星级新增售后服务时长和平台介入率评分，且保留原始指标", () => {
  const scoreMetrics = listShopStarIndicatorScoreMetrics({
    "售后服务时长": 8,
    "平台介入率": 10
  });
  assert.deepEqual(scoreMetrics.map((metric) => ({
    metricName: metric.metricName,
    metricValue: metric.metricValue,
    unit: metric.unit,
    sourceOriginalMetricName: metric.sourceOriginalMetricName
  })), [
    {
      metricName: "售后服务时长得分",
      metricValue: 8,
      unit: "分",
      sourceOriginalMetricName: "售后服务时长"
    },
    {
      metricName: "平台介入率得分",
      metricValue: 10,
      unit: "分",
      sourceOriginalMetricName: "平台介入率"
    }
  ]);
  const { definitions: rawMetrics, skipped } = listBasicIndicatorMetrics({
    zbs: {
      Vane_CheckProcDuration: { pfen: "12.215" },
      Vane_IntervOrigin: { pfen: "0.22148" }
    }
  });
  assert.equal(rawMetrics.find((metric) => metric.metricName === "售后服务时长").metricValue, 12.215);
  assert.ok(Math.abs(
    rawMetrics.find((metric) => metric.metricName === "平台介入率（店铺星级）").metricValue - 0.0022148
  ) < 1e-12);
  assert.equal(skipped.length, 9);
});
