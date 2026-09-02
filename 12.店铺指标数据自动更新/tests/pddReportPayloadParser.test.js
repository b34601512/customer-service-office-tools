const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPddStoreMetricRecords,
  buildPddPageMetricRecords,
  parsePddNumericValue,
  resolvePddStatisticsRange
} = require("../src/platforms/pdd/storeMetrics/pddReportPayloadParser");

const store = {
  key: "pdd02",
  displayName: "德达拼多多02",
  sources: { customer: "https://mms.pinduoduo.com/sycm/goods_quality/customer" }
};

test("拼多多页面百分比统一转成小数，统计区间按页面口径生成", () => {
  assert.equal(parsePddNumericValue("0.22 %", "%").metricValue, 0.0022);
  assert.equal(parsePddNumericValue("15.25 小时 优于98.90%同行同层", "小时").metricValue, 15.25);
  assert.deepEqual(resolvePddStatisticsRange("2026-08-01", 30), {
    statisticsStartDate: "2026-07-03",
    statisticsEndDate: "2026-08-01",
    originalStatisticsWindow: "页面近30天：2026-07-03至2026-08-01"
  });
});

test("拼多多三类店铺页面生成整体指标，并补充响应时长秒值", () => {
  const { records } = buildPddStoreMetricRecords({
    store,
    collectedAt: "2026-08-02T00:00:00.000Z",
    pageSnapshots: [
      {
        pageType: "customer",
        sourceUrl: store.sources.customer,
        pageText: "客服服务数据 统计时间：2026-08-01 3分钟人工回复率 97.41 % 平均人工响应时长 0.37 分钟 询单转化率 -- 客服销售额 0.00 元"
      },
      {
        pageType: "afterSales",
        sourceUrl: "https://mms.pinduoduo.com/sycm/goods_quality/after_sale",
        pageText: "整体情况（统计时间：2026-08-01）纠纷退款数 4 -- 纠纷退款率 0.22 % 介入订单数 264 介入率 14.84 % 品质退款率 2.19 % 平均退款时长 15.25 小时 优于98.90%同行同层 成功退款订单数 11 成功退款金额 4,723.22 元 成功退款率 31.03 % 退货退款自主完结时长 70.73 小时 退款自主完结时长 0.73 小时"
      },
      {
        pageType: "overall",
        sourceUrl: "https://mms.pinduoduo.com/sycm/goods_quality/pilot",
        pageText: "即日起店铺领航员将升级为店铺综合体验星级，4.5星对应店铺领航员超过30%的商家。店铺综合体验星级 统计时间：2026-07-31 5 星 拼多多App显示5.0星 已超越80%同行，满足大部分活动门槛要求 领航员综合分行业排名 99 % 近30天平台求助率 13.56 % 近30天3分钟人工回复率 96.96 % 近30天在途订单退款时长 1.19 小时 近30天商家签收消费者退货订单后的平均退款时长 4.07 小时 近90天用户评价得分排名 85.73 % 近30天积极评论率 98.67 % 近30天严重劣质率 0.01 % 近30天成团-签收时效 2.12 天 近30天物流综合违规处理率 0.11 % 近30天店铺活跃度 99 %"
      }
    ]
  });
  assert.equal(records.length, 29);
  assert.equal(records.find((record) => record.metricName === "拼多多-平均人工响应时长（秒）").metricValue, 22.2);
  assert.equal(records.find((record) => record.metricName === "拼多多-平均人工响应时长（秒）").unit, "秒");
  assert.equal(records.find((record) => record.metricName === "拼多多-纠纷退款率").metricValue, 0.0022);
  assert.ok(Math.abs(records.find((record) => record.metricName === "拼多多-平均退款时长优于同行同层比例").metricValue - 0.989) < 1e-12);
  assert.equal(records.find((record) => record.metricName === "拼多多-平均退款时长优于同行同层比例").unit, "%");
  assert.equal(records.find((record) => record.metricName === "拼多多-店铺综合体验星级").metricValue, 5);
  assert.equal(records.find((record) => record.metricName === "拼多多-店铺综合体验星级同行超越比例").metricValue, 0.8);
  assert.equal(records.find((record) => record.metricName === "拼多多-平台介入率").metricValue, 0.1484);
  assert.equal(records.find((record) => record.metricName === "拼多多-近30天积极评价率").metricValue, 0.9867);
  assert.equal(records.find((record) => record.metricName === "拼多多-近30天平台求助率").statisticsStartDate, "2026-07-02");
  assert.ok(records.every((record) => record.platform === "拼多多" && record.storeKey === "pdd02"));
  assert.equal(new Set(records.map((record) => record.recordKey)).size, records.length);
  assert.equal(buildPddPageMetricRecords({
    store,
    pageType: "afterSales",
    sourceUrl: "https://mms.pinduoduo.com/sycm/goods_quality/detail",
    pageText: "售后数据 TOP退款商品 纠纷退款数 纠纷退款率 暂无数据"
  }).records.length, 0);
});
