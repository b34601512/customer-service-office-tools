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
const currentServicePageText = "体验分概览 更新时间：2026-09-09 11:00:37（今日已更新） 我的总分 82 分 商品体验 69 分 物流体验 99 分 服务体验 85 分 商品综合评分 4.6923 分 商品品质退货率 1.340 % 平均揽收时长 5.5741 小时 运单配送时效达成率 99.412 % 飞鸽人工会话平响时长 13.893 秒 售后平均审核时长 3.3061 小时 飞鸽人工会话不满意率 5.357 % 平台求助率 0.6522 % 加分项 +2 分 扣分项 0 分 虚假交易刷体验分 0 分";

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

test("抖音新版体验分页面可就绪，缺少旧版卡片的指标记为0", () => {
  assert.equal(isDouyinExperienceScoreContentReady(currentServicePageText), true);
  assert.equal(resolveDouyinDataDate(currentServicePageText), "2026-09-09");
  const { records, zeroDataMetrics } = buildDouyinStoreMetricRecords({
    store,
    pageText: currentServicePageText,
    sourceUrl: "https://fxg.jinritemai.com/ffa/eco/experience-score",
    collectedAt: "2026-09-09T03:00:00.000Z",
    fallbackDate: new Date("2026-09-09T00:00:00+08:00")
  });
  assert.equal(records.length, 14);
  assert.equal(records.find((record) => record.metricName === "抖音-服务体验得分").metricValue, 85);
  assert.equal(records.find((record) => record.metricName === "抖音-飞鸽平均响应时长").metricValue, 13.893);
  assert.equal(records.find((record) => record.metricName === "抖音-飞鸽会话不满意率").metricValue, 0.05357);
  assert.equal(records.find((record) => record.metricName === "抖音-售后平均审核时长").metricValue, 3.3061);
  assert.ok(zeroDataMetrics.includes("飞鸽平均响应时长得分"));
  assert.ok(zeroDataMetrics.includes("影响消费者体验次数"));
  assert.ok(records.every((record) => record.dataDate === "2026-09-09"));
});
