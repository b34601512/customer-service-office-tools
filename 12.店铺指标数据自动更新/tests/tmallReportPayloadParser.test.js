const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseJsonpBody,
  parseMtopRequestData
} = require("../src/platforms/tmall/storeMetrics/tmallReportResponseCapture");
const {
  buildTmallStoreMetricRecords
} = require("../src/platforms/tmall/storeMetrics/tmallReportPayloadParser");

function createSummaryMetric(name, value, showValue, unit, interval, extra = {}) {
  return {
    name,
    value,
    showValue,
    unit,
    indexDesc: { interval },
    score: "4.3",
    ...extra
  };
}

test("解析天猫JSONP和嵌套请求日期", () => {
  const payload = parseJsonpBody("mtopjsonp1({\"ret\":[\"SUCCESS::调用成功\"],\"data\":{\"ok\":true}})");
  assert.equal(payload.data.ok, true);
  const requestData = encodeURIComponent(JSON.stringify({
    componentId: "tmallStoreIndicators",
    params: JSON.stringify({ startDate: "20260702", endDate: "20260801" })
  }));
  const parsedRequest = parseMtopRequestData(`https://example.com/api?data=${requestData}`);
  assert.equal(parsedRequest.componentId, "tmallStoreIndicators");
  assert.equal(parsedRequest.params.endDate, "20260801");
});

test("天猫真实体验分生成原值和考核得分并保留各自统计区间", () => {
  const indicatorData = {
    list: [
      { code: "nps", name: "真实体验分", score: "4.88" },
      { code: "newGoods", name: "宝贝质量", score: "4.51" },
      { code: "newLogistics", name: "物流速度", score: "4.96" },
      { code: "newServices", name: "服务保障", score: "4.86" }
    ]
  };
  const summaryData = {
    mainIndexInfoList: [
      {
        name: "宝贝质量",
        subIndexInfoList: [
          createSummaryMetric("商品负反馈率", "0.012441", "1.2441%", "", "30天，2026-07-02~2026-07-31"),
          createSummaryMetric("商品好评率", "0.9791", "97.91%", "", "30天，2026-07-02~2026-07-31")
        ]
      },
      {
        name: "物流速度",
        subIndexInfoList: [
          createSummaryMetric("48小时揽收及时率", "1.0", "100.00%", "", "30天，2026-06-30~2026-07-29"),
          createSummaryMetric("物流到货时长", "49.28", "49.28", "小时", "30天，2026-06-23~2026-07-22")
        ]
      },
      {
        name: "服务保障",
        subIndexInfoList: [
          createSummaryMetric("3分钟人工响应率", "0.9985", "99.85%", "", "30天，2026-07-03~2026-08-01"),
          createSummaryMetric("旺旺满意度", "0.9456", "94.56%", "", "30天，2026-07-01~2026-07-30"),
          createSummaryMetric("退款处理时长", "10.52", "10.52", "小时", "30天，2026-07-02~2026-07-31"),
          createSummaryMetric("平台求助率", "0", "0.0000%", "", "30天，2026-07-03~2026-08-01", {
            tagDTO: { text: "优+订单3倍加权" }
          })
        ]
      },
      {
        name: "附加分",
        subIndexInfoList: [
          createSummaryMetric("当日/次日达订单占比", "0.1507", "15.07%", "", "30天，2026-07-01~2026-07-30")
        ]
      }
    ]
  };
  const { records } = buildTmallStoreMetricRecords({
    store: {
      key: "tmall1",
      displayName: "天猫1店",
      sources: { serverReport: "https://qn.taobao.com/home.html/voc-tmall/serverReport" }
    },
    dataDate: "20260801",
    statisticsStartDate: "20260702",
    statisticsEndDate: "20260801",
    indicatorData,
    summaryData,
    collectedAt: "2026-08-02T00:00:00.000Z"
  });
  assert.equal(records.length, 22);
  assert.equal(records.find((record) => record.metricName === "天猫-商品负反馈率").metricValue, 0.012441);
  assert.equal(records.find((record) => record.metricName === "天猫-商品负反馈率-考核得分").metricValue, 4.3);
  assert.equal(records.find((record) => record.metricName === "天猫-商品负反馈率-考核得分").unit, "分");
  assert.equal(records.find((record) => record.metricName === "天猫-物流到货时长").statisticsStartDate, "2026-06-23");
  assert.equal(
    records.find((record) => record.metricName === "天猫-平台求助率").sourceOriginalMetricName,
    "平台求助率（优+订单3倍加权）"
  );
  assert.ok(records.every((record) => record.platform === "天猫" && record.dataDate === "2026-08-01"));
});
