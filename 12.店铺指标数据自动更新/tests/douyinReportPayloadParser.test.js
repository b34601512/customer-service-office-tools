const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDouyinStoreMetricRecords,
  parseDouyinNumericValue,
  resolveDouyinDataDate
} = require("../src/platforms/douyin/storeMetrics/douyinReportPayloadParser");
const { isDouyinExperienceScoreContentReady } = require("../src/platforms/douyin/storeMetrics/douyinPageNavigator");

const store = {
  key: "douyin1",
  displayName: "德达抖音",
  platformStoreId: "162329841",
  platformStoreName: "德达医疗康养器械旗舰店"
};

const servicePageText = "服务体验 服务体验得分 95 分 较前1日持平 飞鸽平均响应时长得分 100 分 较前1日持平 x25秒/权重=25分 售后平均审核时长得分 100 分 较前1日持平 x25秒/权重=25分 飞鸽会话不满意率得分 90 分 较前1日持平 x25秒/权重=22.5分 平台求助率得分 90 分 较前1日持平 x25秒/权重=22.5分 考核指标 飞鸽平均响应时长 查看详情 100分 店铺表现 13.872秒 较前1日持平 售后平均审核时长 查看详情 100分 店铺表现 1.7712小时 较前1日持平 飞鸽会话不满意率 查看详情 90分 店铺表现 11.1111% 较前1日持平 平台求助率 查看详情 90分 店铺表现 0.3937% 较前1日持平 差行为扣分 0 分 虚假交易刷体验分扣分 0 分 影响消费者体验扣分 0 分 虚假交易刷体验分 0 次 影响消费者体验 0 次";

test("抖音服务体验页面状态和百分比转换正确", () => {
  assert.equal(isDouyinExperienceScoreContentReady(servicePageText), true);
  assert.equal(parseDouyinNumericValue("11.1111%", "%").metricValue, 0.111111);
  assert.equal(resolveDouyinDataDate("服务体验 统计时间：2026-08-01 服务体验得分 95分"), "2026-08-01");
});

test("抖音服务体验页面分别采集得分和店铺表现", () => {
  const { records, skipped } = buildDouyinStoreMetricRecords({
    store,
    pageText: servicePageText,
    sourceUrl: "https://fxg.jinritemai.com/ffa/eco/experience-score",
    collectedAt: "2026-08-02T00:00:00.000Z",
    fallbackDate: new Date("2026-08-02T00:00:00+08:00")
  });
  assert.equal(records.length, 14);
  assert.equal(records.find((record) => record.metricName === "抖音-服务体验得分").metricValue, 95);
  assert.equal(records.find((record) => record.metricName === "抖音-飞鸽平均响应时长得分").metricValue, 100);
  assert.equal(records.find((record) => record.metricName === "抖音-飞鸽平均响应时长").metricValue, 13.872);
  assert.equal(records.find((record) => record.metricName === "抖音-售后平均审核时长").metricValue, 1.7712);
  assert.equal(records.find((record) => record.metricName === "抖音-飞鸽会话不满意率").metricValue, 0.111111);
  assert.ok(Math.abs(records.find((record) => record.metricName === "抖音-平台求助率").metricValue - 0.003937) < 1e-12);
  assert.equal(records.find((record) => record.metricName === "抖音-虚假交易刷体验分次数").metricValue, 0);
  assert.ok(records.every((record) => record.platform === "抖音" && record.storeKey === "douyin1"));
});
