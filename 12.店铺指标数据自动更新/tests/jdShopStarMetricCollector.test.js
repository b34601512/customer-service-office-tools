const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveWindowDates,
  listBasicIndicatorMetrics,
  listShopStarIndicatorScoreMetrics,
  listSummaryMetrics,
  listServiceProductMetrics,
  readJsonResponse,
  hasJsonResponseData,
  hasShopStarBasicData,
  hasShopStarStarsData,
  hasCompleteShopStarApiData,
  createEmptyShopStarApiData,
  resolveJdApiName,
  isShopStarApiResponse,
  resolveShopStarPageDataDate,
  isShopStarDataUnavailableText,
  hasShopStarPageDataState,
  jdShopStarApiNames,
  isModernShopStarData,
  getShopStarProtocol,
  normalizeShopStarApiData,
  isRequiredShopStarApi
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

test("店铺星级缺少可选指标时写入0并记录无数据标记", () => {
  const basicResult = listBasicIndicatorMetrics({ zbs: {} });
  assert.equal(basicResult.definitions.length, 11);
  assert.equal(basicResult.skipped.length, 11);
  assert.ok(basicResult.definitions.every((metric) => metric.metricValue === 0 && metric.zeroData === true));

  const summaryMetrics = listSummaryMetrics({}, {});
  assert.equal(summaryMetrics.length, 9);
  assert.ok(summaryMetrics.every((metric) => metric.metricValue === 0 && metric.zeroData === true));

  const scoreMetrics = listShopStarIndicatorScoreMetrics({});
  assert.equal(scoreMetrics.length, 2);
  assert.ok(scoreMetrics.every((metric) => metric.metricValue === 0 && metric.zeroData === true));
});

test("店铺星级接口明确返回空数据时按无数据处理，并能从页面取日期", async () => {
  const emptyResponse = {
    ok: () => true,
    json: async () => ({ code: 200, data: null })
  };
  const result = await readJsonResponse(Promise.resolve(emptyResponse), "星级指标", { allowEmptyData: true });
  assert.deepEqual(result.data, {});
  await assert.rejects(
    readJsonResponse(Promise.resolve(emptyResponse), "星级指标"),
    /接口数据无效：星级指标/
  );
  assert.equal(resolveShopStarPageDataDate("店铺星级 数据更新时间 2026-09-09 数据日期 当前星级 暂无"), "2026-09-09");
});

test("京东店铺星级接口空对象也视为占位响应，不能提前写入0", () => {
  assert.equal(hasJsonResponseData(null), false);
  assert.equal(hasJsonResponseData({}), false);
  assert.equal(hasJsonResponseData([]), false);
  assert.equal(hasJsonResponseData({ finalScore: 85 }), true);
});

test("新版Vane页面的完整接口对象被识别为真实数据", () => {
  const basicResult = {
    empty: false,
    data: {
      opTime: "2026-09-08",
      finalScore: 10.14,
      validOrderNum: "1792",
      zbs: {
        Vane_ScoreRankRate: { pji: "5.0", rank: 88.58 },
        Vane_ResponseSpeed: { pfen: "12.15", pji: "10.0" }
      }
    }
  };
  const starsResult = {
    empty: false,
    data: {
      venderId: "63530",
      shopName: "德达官方旗舰店",
      customServiceConsultScore: "10.0",
      logisticsLvyueScore: "9.9"
    }
  };
  assert.equal(hasShopStarBasicData(basicResult.data), true);
  assert.equal(hasShopStarStarsData(starsResult.data), true);
  assert.equal(hasCompleteShopStarApiData({ basicResult, starsResult }), true);
  assert.equal(
    hasShopStarPageDataState("星级概览 当前星级 五星店铺 体验得分 客服咨询 10.0分 物流履约 9.9分 售后服务 9.1分 商品质量 8.8分"),
    true
  );
});

test("京东星级接口601仅在页面确认无星级时允许按空数据继续", async () => {
  const busyResponse = {
    ok: () => true,
    json: async () => ({ code: 601, msg: "请求繁忙，请稍后再试 [601]" })
  };
  const result = await readJsonResponse(Promise.resolve(busyResponse), "星级指标", {
    allowEmptyData: true,
    allowEmptyResponseCodes: [601]
  });
  assert.equal(result.code, 601);
  assert.equal(result.empty, true);
  assert.equal(isShopStarDataUnavailableText("数据更新时间 2026-09-09 当前星级 暂无"), true);
  assert.equal(hasShopStarPageDataState("数据更新时间 2026-09-09 当前星级 暂无"), true);
  assert.equal(hasShopStarPageDataState("数据更新时间 2026-09-09 当前星级 5.0"), true);
  assert.equal(isShopStarDataUnavailableText("数据更新时间 2026-09-09 当前星级 5.0"), false);
  await assert.rejects(
    readJsonResponse(Promise.resolve(busyResponse), "星级指标", { allowEmptyData: true }),
    /接口数据无效：星级指标.*code=601/
  );
});

test("京东新版接口按api参数精确匹配，避免把流量接口当成星级汇总", () => {
  const starsApi = "dsm.shop.vane.view.core.export.ohs.stars.service.VaneStarsFacade";
  const response = (url) => ({
    url: () => url,
    request: () => ({ resourceType: () => "xhr" })
  });
  const mainUrl = `https://api.jd.com/?api=${encodeURIComponent(starsApi)}`;
  const trafficUrl = `https://api.jd.com/?api=${encodeURIComponent(`${starsApi}.queryShopStarTrafficMsg`)}`;
  assert.equal(resolveJdApiName(mainUrl), starsApi);
  assert.equal(isShopStarApiResponse(response(mainUrl), starsApi), true);
  assert.equal(isShopStarApiResponse(response(trafficUrl), starsApi), false);
  assert.equal(isShopStarApiResponse({
    url: () => mainUrl,
    request: () => ({ resourceType: () => "fetch" })
  }, starsApi), true);
});

test("新版VaneStarsFacade单接口可直接映射真实星级和相关指标", () => {
  const modernData = {
    venderId: "715027",
    shopName: "德迩杰官方旗舰店",
    scoreRankRateGrade: "5.0",
    scoreRankRate: 98.01,
    validOrderNum: "1434",
    customServiceConsultScore: "10.0",
    logisticsLvyueScore: "9.9",
    afterServiceScore: "8.5",
    userEvaluateScore: "9.8"
  };
  const results = {
    starsResult: { empty: false, code: 200, data: modernData }
  };
  assert.equal(isModernShopStarData(modernData), true);
  assert.equal(getShopStarProtocol(results), "modern");
  assert.equal(hasCompleteShopStarApiData(results), true);
  const normalized = normalizeShopStarApiData(results, "2026-09-10");
  const metricMap = Object.fromEntries(
    listSummaryMetrics(normalized.basicData, normalized.starsData)
      .map((metric) => [metric.metricName, metric.metricValue])
  );
  assert.equal(normalized.protocol, "modern");
  assert.equal(metricMap["店铺星级"], 5);
  assert.ok(Math.abs(metricMap["店铺星级排名"] - 0.9801) < 1e-12);
  assert.equal(metricMap["近30天有效订单"], 1434);
  assert.equal(metricMap["客服咨询得分"], 10);
  assert.equal(metricMap["物流履约得分"], 9.9);
  assert.equal(metricMap["售后服务得分"], 8.5);
  assert.equal(metricMap["商品体验得分"], 9.8);
  assert.equal(metricMap["店铺体验得分"], 0);
  assert.equal(normalized.basicData.finalScore, undefined);
});

test("京东星级辅助接口601不触发主流程风控接管", () => {
  assert.equal(isRequiredShopStarApi(jdShopStarApiNames.stars), true);
  assert.equal(isRequiredShopStarApi(jdShopStarApiNames.basic), true);
  assert.equal(isRequiredShopStarApi(jdShopStarApiNames.degradation), false);
  assert.equal(isRequiredShopStarApi(jdShopStarApiNames.prejudgment), false);
});

test("页面完整等待后仍显示暂无时生成可写入的无数据结果", () => {
  const result = createEmptyShopStarApiData("店铺星级 当前星级 暂无");
  assert.equal(result.basicResult.empty, true);
  assert.equal(result.starsResult.empty, true);
  assert.equal(result.basicResult.data && Object.keys(result.basicResult.data).length, 0);
  assert.equal(typeof result.basicResult.response.request, "function");
  assert.equal(result.pageText, "店铺星级 当前星级 暂无");
});
