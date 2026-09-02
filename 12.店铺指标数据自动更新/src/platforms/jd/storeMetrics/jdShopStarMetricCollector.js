const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const {
  waitForJdMetricPageText,
  readMetricValue
} = require("./jdMetricText");
const { formatDate, shiftDateText } = require("../../../shared/exportDateRange");

const basicApiToken = "VaneBasicFacade.queryVaneBasic";
const starsApiToken = "VaneStarsFacade";
const shopStarIndicatorScoreDefinitions = [
  {
    sourceMetricName: "售后服务时长",
    metricName: "售后服务时长得分",
    unit: "分",
    statisticsWindow: "近30天"
  },
  {
    sourceMetricName: "平台介入率",
    metricName: "平台介入率得分",
    unit: "分",
    statisticsWindow: "近30天"
  }
];

function parseDateText(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function resolveWindowDates(dataDate, statisticsWindow) {
  if (statisticsWindow === "近30天") return { startDate: shiftDateText(dataDate, -29), endDate: dataDate };
  if (statisticsWindow === "近90天") return { startDate: shiftDateText(dataDate, -89), endDate: dataDate };
  if (statisticsWindow === "近7天") return { startDate: shiftDateText(dataDate, -6), endDate: dataDate };
  if (statisticsWindow === "上1月") {
    const date = parseDateText(dataDate);
    const startDate = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const endDate = new Date(date.getFullYear(), date.getMonth(), 0);
    return { startDate: formatDate(startDate), endDate: formatDate(endDate) };
  }
  return { startDate: dataDate, endDate: dataDate };
}

function createShopStarRecord(store, input) {
  const dateRange = resolveWindowDates(input.dataDate, input.statisticsWindow);
  return createStoreMetricRecord({
    platform: "京东",
    storeKey: store.key,
    storeName: store.displayName,
    dataDate: input.dataDate,
    statisticsStartDate: dateRange.startDate,
    statisticsEndDate: dateRange.endDate,
    metricName: input.metricName,
    metricValue: input.metricValue,
    unit: input.unit,
    originalStatisticsWindow: input.statisticsWindow,
    sourcePage: "店铺星级",
    sourceUrl: store.sources.shopStar,
    sourceOriginalMetricName: input.sourceOriginalMetricName || input.metricName,
    collectedAt: input.collectedAt
  });
}

async function readJsonResponse(responsePromise, responseLabel) {
  const response = await responsePromise;
  if (!response || !response.ok()) {
    throw new Error(`京东店铺星级接口未成功返回：${responseLabel}。`);
  }
  const responseJson = await response.json();
  if (Number(responseJson?.code) !== 200 || !responseJson?.data) {
    throw new Error(`京东店铺星级接口数据无效：${responseLabel}。`);
  }
  return { response, data: responseJson.data };
}

function waitForShopStarResponse(page, apiToken, timeoutMilliseconds = 60000) {
  return page.waitForResponse(
    (response) => response.url().includes(apiToken) && response.request().resourceType() === "xhr",
    { timeout: timeoutMilliseconds }
  );
}

async function applyManualShopStarDate(page, snapshotDate) {
  const dateInput = page.locator('input[placeholder="选择日期"]').first();
  await dateInput.waitFor({ state: "visible", timeout: 15000 });
  const expectedResponse = waitForShopStarResponse(page, basicApiToken, 45000);
  await dateInput.fill(snapshotDate);
  await dateInput.press("Enter");
  const response = await expectedResponse;
  const requestBody = JSON.parse(response.request().postData() || "{}");
  if (String(requestBody?.vaneBasicParam?.date || "") !== snapshotDate) {
    throw new Error(`店铺星级手动日期未生效：期望 ${snapshotDate}。`);
  }
  return response;
}

function listBasicIndicatorMetrics(basicData) {
  const indicators = basicData.zbs || {};
  const definitions = [
    ["Vane_ResponseSpeed", "咚咚平均响应时长", "秒", "近30天", 1],
    ["Vane_SdExpressRate", "当日揽收率", "%", "近30天", 0.01],
    ["Vane_WaybillDelivery", "运单配送时效达成率", "%", "近30天", 0.01],
    ["Vane_OnTime", "预约单准时发货率", "%", "近30天", 0.01],
    ["Vane_ShipDelvReturn", "发货物流品退率", "%", "近30天", 0.01],
    ["Vane_PromiseLate", "延迟发货单量（48小时以上）", "单", "近30天", 1],
    ["Vane_CheckProcDuration", "售后服务时长", "小时", "近30天", 1],
    ["Vane_AfsScoreOrigin", "售后评价得分", "分", "近90天", 1],
    ["Vane_IntervOrigin", "平台介入率（店铺星级）", "%", "近30天", 0.01],
    ["Vane_GoodRateOrigin", "店铺评价得分", "分", "近30天", 1],
    ["Vane_GoodReturn", "商品品质退货率", "%", "近30天", 0.01]
  ];
  const skipped = [];
  const result = definitions.flatMap(([indicatorKey, metricName, unit, window, multiplier]) => {
    const rawValue = Number(indicators[indicatorKey]?.pfen);
    if (!Number.isFinite(rawValue)) { skipped.push(metricName); return []; }
    return [{
      metricName,
      metricValue: rawValue * multiplier,
      unit,
      statisticsWindow: window,
      sourceOriginalMetricName: metricName
    }];
  });
  return { definitions: result, skipped };
}

async function readShopStarIndicatorScores(page, pageText) {
  const scoreEntries = await Promise.all(shopStarIndicatorScoreDefinitions.map(async (definition) => [
    definition.sourceMetricName,
    await readMetricValue(page, pageText, definition.sourceMetricName, definition.unit)
  ]));
  const scores = Object.fromEntries(scoreEntries);
  const skipped = shopStarIndicatorScoreDefinitions
    .filter((definition) => !Number.isFinite(Number(scores[definition.sourceMetricName])))
    .map((definition) => definition.metricName);
  return { scores, skipped };
}

function listShopStarIndicatorScoreMetrics(indicatorScoreValues = {}) {
  return shopStarIndicatorScoreDefinitions.flatMap((definition) => {
    const metricValue = Number(indicatorScoreValues[definition.sourceMetricName]);
    if (!Number.isFinite(metricValue)) return [];
    return [{
      metricName: definition.metricName,
      metricValue,
      unit: definition.unit,
      statisticsWindow: definition.statisticsWindow,
      sourceOriginalMetricName: definition.sourceMetricName
    }];
  });
}

function listSummaryMetrics(basicData, starsData) {
  const starIndicator = basicData.zbs?.Vane_ScoreRankRate || {};
  const definitions = [
    ["店铺星级", Number(starIndicator.pji), "星", "数据日期快照"],
    ["店铺星级排名", Number(starIndicator.rank), "%", "数据日期快照", 0.01],
    ["店铺体验得分", Number(basicData.finalScore), "分", "数据日期快照"],
    ["近30天有效订单", Number(basicData.validOrderNum), "单", "近30天"],
    ["客服咨询得分", Number(starsData.customServiceConsultScore), "分", "数据日期快照"],
    ["物流履约得分", Number(starsData.logisticsLvyueScore), "分", "数据日期快照"],
    ["售后服务得分", Number(starsData.afterServiceScore), "分", "数据日期快照"],
    ["商品体验得分", Number(starsData.userEvaluateScore), "分", "数据日期快照"],
    ["附加项得分", Number(basicData.serviceBonus), "分", "数据日期快照"]
  ];
  return definitions.flatMap(([metricName, rawValue, unit, window, multiplier = 1]) =>
    Number.isFinite(rawValue) ? [{
      metricName,
      metricValue: rawValue * multiplier,
      unit,
      statisticsWindow: window,
      sourceOriginalMetricName: metricName
    }] : []
  );
}

function listServiceProductMetrics(basicData) {
  const windowByName = {
    "金牌客服认证比例": "上1月",
    "店铺复购率": "近90天",
    "店铺价格力": "前1天",
    "打标送货上门率": "近30天",
    "近7天退款不退货执行率": "近7天",
    "价格1星商品占比": "前1天"
  };
  const scoreMetricNames = new Set(["店铺价格力"]);
  return (basicData.serviceProducts || []).flatMap((product) => {
    const rawValue = Number(product.status);
    if (!Number.isFinite(rawValue) || !windowByName[product.name]) return [];
    const unit = scoreMetricNames.has(product.name) ? "分" : "%";
    return [{
      metricName: product.name,
      metricValue: unit === "%" ? rawValue / 100 : rawValue,
      unit,
      statisticsWindow: windowByName[product.name],
      sourceOriginalMetricName: product.name
    }];
  });
}

async function collectJdShopStarMetrics(page, store, dateSelection) {
  const initialBasicResponsePromise = waitForShopStarResponse(page, basicApiToken);
  const starsResponsePromise = waitForShopStarResponse(page, starsApiToken);
  await page.goto(store.sources.shopStar, { waitUntil: "domcontentloaded", timeout: 45000 });
  await waitForJdMetricPageText(page, ["咚咚平均响应时长", "售后评价得分"]);
  await waitForJdMetricPageText(page, ["售后服务时长"]);
  const shopStarPageText = await waitForJdMetricPageText(page, ["平台介入率"]);
  const shopStarIndicatorScores = await readShopStarIndicatorScores(page, shopStarPageText);
  const starsResult = await readJsonResponse(starsResponsePromise, "星级汇总");
  const initialBasicResponse = await initialBasicResponsePromise;
  const selectedBasicResponse = dateSelection.snapshotDate
    ? await applyManualShopStarDate(page, dateSelection.snapshotDate)
    : initialBasicResponse;
  const basicResult = await readJsonResponse(Promise.resolve(selectedBasicResponse), "星级指标");
  const requestBody = JSON.parse(basicResult.response.request().postData() || "{}");
  const dataDate = String(requestBody?.vaneBasicParam?.date || basicResult.data.opTime || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    throw new Error("京东店铺星级没有返回真实数据日期。");
  }
  const collectedAt = new Date().toISOString();
  const basicIndicatorResult = listBasicIndicatorMetrics(basicResult.data);
  const metricDefinitions = [
    ...listSummaryMetrics(basicResult.data, starsResult.data),
    ...basicIndicatorResult.definitions,
    ...listShopStarIndicatorScoreMetrics(shopStarIndicatorScores.scores),
    ...listServiceProductMetrics(basicResult.data)
  ];
  return {
    records: metricDefinitions.map((metricDefinition) => createShopStarRecord(store, {
      ...metricDefinition,
      dataDate,
      collectedAt
    })),
    skipped: [...shopStarIndicatorScores.skipped, ...basicIndicatorResult.skipped]
  };
}

module.exports = {
  resolveWindowDates,
  listBasicIndicatorMetrics,
  listShopStarIndicatorScoreMetrics,
  listSummaryMetrics,
  listServiceProductMetrics,
  collectJdShopStarMetrics
};
