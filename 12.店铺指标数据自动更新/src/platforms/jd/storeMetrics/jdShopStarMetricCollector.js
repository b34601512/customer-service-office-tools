const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const {
  readJdMetricPageText,
  readMetricValue
} = require("./jdMetricText");
const { checkBrowserHumanRequirement } = require("../../../engine/browserHumanGuard");
const { requireHeadedBrowser } = require("../../../engine/browserAutomationScope");
const { formatDate, shiftDateText } = require("../../../shared/exportDateRange");
const shopStarProtocol = require("./jdShopStarProtocol");
const {
  jdShopStarApiNames,
  hasJsonResponseData,
  hasMeaningfulValue,
  isModernShopStarData,
  getShopStarProtocol,
  hasCompleteShopStarApiData,
  normalizeShopStarApiData,
  resolveJdApiName,
  isShopStarApiResponse,
  isRequiredShopStarApi,
  shopStarEmptyResponseCodes
} = shopStarProtocol;

const basicApiToken = jdShopStarApiNames.basic;
const starsApiToken = jdShopStarApiNames.stars;
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
const shopStarLoadTimeoutMilliseconds = 60000;
const shopStarResponseTimeoutMilliseconds = 30000;
const shopStarRateLimitWaitMilliseconds = 15000;

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

async function readJsonResponse(
  responsePromise,
  responseLabel,
  { allowEmptyData = false, allowEmptyResponseCodes = [] } = {}
) {
  const response = await responsePromise;
  if (!response || !response.ok()) {
    throw new Error(`京东店铺星级接口未成功返回：${responseLabel}。`);
  }
  const responseJson = await response.json();
  const responseCode = Number(responseJson?.code);
  const allowEmptyResponse = allowEmptyData && allowEmptyResponseCodes.includes(responseCode);
  const hasData = hasJsonResponseData(responseJson?.data);
  if (responseCode !== 200 && !allowEmptyResponse) {
    throw new Error(
      `京东店铺星级接口数据无效：${responseLabel}（code=${responseJson?.code ?? "空"}，${responseJson?.msg || "无返回说明"}）。`
    );
  }
  if (!hasData && !allowEmptyData) {
    throw new Error(`京东店铺星级接口数据无效：${responseLabel}。`);
  }
  return {
    response,
    data: responseJson.data || {},
    code: responseCode,
    message: String(responseJson?.msg || responseJson?.message || ""),
    empty: responseCode !== 200 || !hasData
  };
}

function createEmptyShopStarApiData(pageText, partialResults = null) {
  const createEmptyResult = (label) => ({
    response: {
      request: () => ({ postData: () => "" })
    },
    data: {},
    code: 200,
    message: `页面已确认${label}暂无数据`,
    empty: true
  });
  return {
    basicResult: partialResults?.basicResult || createEmptyResult("星级指标"),
    starsResult: partialResults?.starsResult || createEmptyResult("星级汇总"),
    pageText
  };
}

function resolveShopStarPageDataDate(pageText) {
  const normalizedText = String(pageText || "").replace(/\s+/g, " ").trim();
  const dateMatch = normalizedText.match(/(?:数据日期|数据更新时间)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/);
  return dateMatch?.[1] || "";
}

function isShopStarDataUnavailableText(pageText) {
  const normalizedText = String(pageText || "").replace(/\s+/g, " ").trim();
  return /当前星级\s*(?:暂无|无数据|[-—])/.test(normalizedText);
}

function hasShopStarPageDataState(pageText) {
  const normalizedText = String(pageText || "").replace(/\s+/g, " ").trim();
  const hasDataDate = /(?:数据日期|数据更新时间)\s*[:：]?\s*\d{4}-\d{2}-\d{2}/.test(normalizedText);
  const hasCurrentStarState = /当前星级\s*(?:暂无|无数据|[-—]|[1-5](?:\.\d+)?\s*星?)/.test(normalizedText);
  const hasNewShopStarStructure = normalizedText.includes("星级概览") &&
    normalizedText.includes("体验得分") &&
    ["客服咨询", "物流履约", "售后服务", "商品质量"].every((keyword) => normalizedText.includes(keyword));
  return (hasDataDate && hasCurrentStarState) || hasNewShopStarStructure;
}

async function waitForShopStarPageDataState(page, timeoutMilliseconds = shopStarLoadTimeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let latestPageText = "";
  while (Date.now() <= deadline) {
    await checkBrowserHumanRequirement({ includeLogin: true });
    latestPageText = await readJdMetricPageText(page);
    if (hasShopStarPageDataState(latestPageText)) return latestPageText;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`京东店铺星级页面未出现完整数据状态。当前页面=${page.url()}`);
}

function waitForShopStarResponse(page, apiToken, timeoutMilliseconds = shopStarLoadTimeoutMilliseconds) {
  return page.waitForResponse(
    (response) => isShopStarApiResponse(response, apiToken),
    { timeout: timeoutMilliseconds }
  );
}

function getShopStarApiResponseLabel(apiName) {
  return apiName === basicApiToken ? "星级指标" : "星级汇总";
}

// 只监听两个主接口。新版页面的 VaneStarsFacade 单独即可完成采集，
// degradation/prejudgment 的 601 仅表示辅助卡片繁忙，不能把主流程拖入重试。
function waitForShopStarApiResponses(page, timeoutMilliseconds) {
  return new Promise((resolve, reject) => {
    const results = {};
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      page.off?.("response", onResponse);
    };
    const settle = (error, outcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(outcome);
    };
    const onResponse = (response) => {
      const apiName = resolveJdApiName(response.url());
      if (!isRequiredShopStarApi(apiName)) return;
      const responseLabel = getShopStarApiResponseLabel(apiName);
      readJsonResponse(Promise.resolve(response), responseLabel, {
        allowEmptyData: true,
        allowEmptyResponseCodes: shopStarEmptyResponseCodes
      }).then((result) => {
        if (settled) return;
        if (apiName === basicApiToken) results.basicResult = result;
        if (apiName === starsApiToken) results.starsResult = result;
        if (result.code === 601) {
          settle(null, {
            type: "rate-limit",
            rateLimit: {
              apiName,
              message: result.message || "京东店铺星级主接口请求繁忙（code=601）"
            },
            results
          });
          return;
        }
        if (apiName === starsApiToken && isModernShopStarData(result.data)) {
          settle(null, { type: "responses", results });
          return;
        }
        if (hasCompleteShopStarApiData(results)) {
          settle(null, { type: "responses", results });
        }
      }).catch((error) => settle(error));
    };

    page.on("response", onResponse);
    timer = setTimeout(() => {
      settle(new Error(`京东店铺星级主接口在${timeoutMilliseconds}毫秒内没有返回有效数据。`));
    }, timeoutMilliseconds);
  });
}

function handleShopStarRateLimit(rateLimit) {
  if (!rateLimit) return false;
  requireHeadedBrowser(
    `${rateLimit.message || "京东店铺星级主接口请求繁忙（code=601）"}，正在切换可见 Chrome 重试`
  );
  return true;
}

async function waitForShopStarRateLimitRetry(page, deadline) {
  const remainingMilliseconds = Math.max(0, deadline - Date.now());
  if (remainingMilliseconds > 0) {
    await page.waitForTimeout(Math.min(shopStarRateLimitWaitMilliseconds, remainingMilliseconds));
  }
}

function readResponseRequestBody(response) {
  try {
    return JSON.parse(response?.request?.().postData?.() || "{}");
  } catch {
    return {};
  }
}

async function waitForShopStarApiData(page, shopStarUrl, timeoutMilliseconds = shopStarLoadTimeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let attempt = 0;
  let latestResults = null;
  let latestPageText = "";
  let lastError = null;

  while (Date.now() <= deadline) {
    await checkBrowserHumanRequirement({ includeLogin: true });
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) break;
    const responsePromise = waitForShopStarApiResponses(
      page,
      Math.min(shopStarResponseTimeoutMilliseconds, remainingMilliseconds)
    );
    // 导航异常时仍需消费掉响应等待 Promise，避免下一轮产生未处理拒绝。
    responsePromise.catch(() => {});
    try {
      if (attempt === 0) {
        await page.goto(shopStarUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.min(45000, remainingMilliseconds)
        });
      } else {
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: Math.min(45000, remainingMilliseconds)
        });
      }
      const outcome = await responsePromise;
      if (outcome.type === "rate-limit") {
        handleShopStarRateLimit(outcome.rateLimit);
        await waitForShopStarRateLimitRetry(page, deadline);
        attempt += 1;
        continue;
      }
      latestResults = outcome.results;
      if (hasCompleteShopStarApiData(latestResults)) {
        return {
          ...latestResults,
          pageText: await readJdMetricPageText(page).catch(() => "")
        };
      }
      latestPageText = await readJdMetricPageText(page).catch(() => latestPageText);
      if (isShopStarDataUnavailableText(latestPageText)) {
        return createEmptyShopStarApiData(latestPageText, latestResults);
      }
      lastError = new Error("京东店铺星级接口返回了占位数据，但页面没有确认无数据。");
    } catch (error) {
      if (["BROWSER_NEEDS_HUMAN", "BROWSER_RUN_CANCELLED"].includes(error?.code)) {
        throw error;
      }
      lastError = error;
      latestPageText = await readJdMetricPageText(page).catch(() => latestPageText);
      if (isShopStarDataUnavailableText(latestPageText)) {
        return latestResults
          ? { ...latestResults, pageText: latestPageText }
          : createEmptyShopStarApiData(latestPageText);
      }
      if (Date.now() >= deadline) break;
    }
    attempt += 1;
  }

  latestPageText = await readJdMetricPageText(page).catch(() => latestPageText);
  if (isShopStarDataUnavailableText(latestPageText)) {
    return latestResults
      ? { ...latestResults, pageText: latestPageText }
      : createEmptyShopStarApiData(latestPageText);
  }
  if (lastError) throw lastError;
  throw new Error(`京东店铺星级接口在${timeoutMilliseconds}毫秒内没有返回有效数据。`);
}

function createOptionalMetricDefinition({
  metricName,
  rawValue,
  unit,
  statisticsWindow,
  multiplier = 1,
  sourceOriginalMetricName = metricName
}) {
  const numericValue = Number(rawValue);
  const hasValue = hasMeaningfulValue(rawValue) && Number.isFinite(numericValue);
  return {
    metricName,
    metricValue: hasValue ? numericValue * multiplier : 0,
    unit,
    statisticsWindow,
    sourceOriginalMetricName,
    zeroData: !hasValue
  };
}

async function applyManualShopStarDate(page, snapshotDate) {
  const dateInput = page.locator('input[placeholder="选择日期"]').first();
  await dateInput.waitFor({ state: "visible", timeout: 15000 });
  const deadline = Date.now() + shopStarLoadTimeoutMilliseconds;
  let latestResult = null;
  while (Date.now() <= deadline) {
    const expectedResponse = waitForShopStarResponse(
      page,
      basicApiToken,
      Math.min(45000, Math.max(1000, deadline - Date.now()))
    );
    await dateInput.fill(snapshotDate);
    await dateInput.press("Enter");
    const result = await readJsonResponse(expectedResponse, "星级指标", {
      allowEmptyData: true,
      allowEmptyResponseCodes: shopStarEmptyResponseCodes
    });
    const requestBody = readResponseRequestBody(result.response);
    if (String(requestBody?.vaneBasicParam?.date || "") !== snapshotDate) {
      throw new Error(`店铺星级手动日期未生效：期望 ${snapshotDate}。`);
    }
    latestResult = result;
    if (!result.empty) return result;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(shopStarResponseTimeoutMilliseconds, deadline - Date.now()));
  }
  return latestResult;
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
  const result = definitions.map(([indicatorKey, metricName, unit, window, multiplier]) =>
    createOptionalMetricDefinition({
      metricName,
      rawValue: indicators[indicatorKey]?.pfen,
      unit,
      statisticsWindow: window,
      multiplier,
      sourceOriginalMetricName: metricName
    }));
  const skipped = result.filter((metric) => metric.zeroData).map((metric) => metric.metricName);
  return { definitions: result, skipped };
}

async function readShopStarIndicatorScores(page, pageText, basicData = {}) {
  const basicIndicatorKeys = {
    "售后服务时长": "Vane_CheckProcDuration",
    "平台介入率": "Vane_IntervOrigin"
  };
  const scoreEntries = await Promise.all(shopStarIndicatorScoreDefinitions.map(async (definition) => {
    const apiValue = basicData?.zbs?.[basicIndicatorKeys[definition.sourceMetricName]]?.pji;
    if (hasMeaningfulValue(apiValue) && Number.isFinite(Number(apiValue))) {
      return [definition.sourceMetricName, Number(apiValue)];
    }
    return [
      definition.sourceMetricName,
      await readMetricValue(page, pageText, definition.sourceMetricName, definition.unit)
    ];
  }));
  const scores = Object.fromEntries(scoreEntries);
  const skipped = shopStarIndicatorScoreDefinitions
    .filter((definition) => !Number.isFinite(Number(scores[definition.sourceMetricName])))
    .map((definition) => definition.metricName);
  return { scores, skipped };
}

function listShopStarIndicatorScoreMetrics(indicatorScoreValues = {}) {
  return shopStarIndicatorScoreDefinitions.map((definition) =>
    createOptionalMetricDefinition({
      metricName: definition.metricName,
      rawValue: indicatorScoreValues[definition.sourceMetricName],
      unit: definition.unit,
      statisticsWindow: definition.statisticsWindow,
      sourceOriginalMetricName: definition.sourceMetricName
    }));
}

function listSummaryMetrics(basicData, starsData) {
  const starIndicator = basicData.zbs?.Vane_ScoreRankRate || {};
  const definitions = [
    ["店铺星级", starIndicator.pji, "星", "数据日期快照"],
    ["店铺星级排名", starIndicator.rank, "%", "数据日期快照", 0.01],
    ["店铺体验得分", basicData.finalScore, "分", "数据日期快照"],
    ["近30天有效订单", basicData.validOrderNum, "单", "近30天"],
    ["客服咨询得分", starsData.customServiceConsultScore, "分", "数据日期快照"],
    ["物流履约得分", starsData.logisticsLvyueScore, "分", "数据日期快照"],
    ["售后服务得分", starsData.afterServiceScore, "分", "数据日期快照"],
    ["商品体验得分", starsData.userEvaluateScore, "分", "数据日期快照"],
    ["附加项得分", basicData.serviceBonus, "分", "数据日期快照"]
  ];
  return definitions.map(([metricName, rawValue, unit, window, multiplier = 1]) =>
    createOptionalMetricDefinition({
      metricName,
      rawValue,
      unit,
      statisticsWindow: window,
      multiplier,
      sourceOriginalMetricName: metricName
    }));
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

function createEmptyShopStarResult() {
  return {
    response: { request: () => ({ postData: () => "" }) },
    data: {},
    empty: true,
    code: 200,
    message: ""
  };
}

async function collectJdShopStarMetrics(page, store, dateSelection) {
  const initialShopStarData = await waitForShopStarApiData(page, store.sources.shopStar);
  const initialShopStarPageText = initialShopStarData.pageText || "";
  const starsResult = initialShopStarData.starsResult || createEmptyShopStarResult();
  const initialProtocol = getShopStarProtocol(initialShopStarData);
  if (dateSelection?.snapshotDate && initialProtocol === "modern") {
    throw new Error("京东新版店铺星级接口当前只返回实时数据，暂不支持手动历史日期，未写入。请切换为自动日期。");
  }
  const basicResult = dateSelection?.snapshotDate
    ? await applyManualShopStarDate(page, dateSelection.snapshotDate)
    : initialShopStarData.basicResult || createEmptyShopStarResult();
  const shopStarPageText = dateSelection?.snapshotDate
    ? await waitForShopStarPageDataState(page)
    : initialShopStarPageText;
  const shopStarDataUnavailable = isShopStarDataUnavailableText(shopStarPageText);
  const emptyResponseLabels = [
    starsResult.empty ? "星级汇总" : "",
    basicResult.empty ? "星级指标" : ""
  ].filter(Boolean);
  if (emptyResponseLabels.length && !shopStarDataUnavailable && !getShopStarProtocol({ basicResult, starsResult })) {
    throw new Error(
      `京东店铺星级接口返回空数据：${emptyResponseLabels.join("、")}，但页面未确认当前星级无数据。`
    );
  }

  const pageDataDate = resolveShopStarPageDataDate(shopStarPageText || initialShopStarPageText);
  const requestBody = readResponseRequestBody(basicResult.response);
  const dataDate = String(
    basicResult.data.opTime ||
    (basicResult.empty ? "" : requestBody?.vaneBasicParam?.date) ||
    pageDataDate ||
    formatDate(new Date())
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    throw new Error("京东店铺星级没有返回真实数据日期。");
  }

  const normalizedShopStarData = normalizeShopStarApiData({ basicResult, starsResult }, dataDate);
  if (!normalizedShopStarData && !shopStarDataUnavailable) {
    throw new Error("京东店铺星级接口返回的数据协议无法识别，未写入。");
  }
  const basicData = normalizedShopStarData?.basicData || {};
  const starsData = normalizedShopStarData?.starsData || {};
  const shopStarIndicatorScores = await readShopStarIndicatorScores(page, shopStarPageText, basicData);
  const collectedAt = new Date().toISOString();
  const basicIndicatorResult = listBasicIndicatorMetrics(basicData);
  const metricDefinitions = [
    ...listSummaryMetrics(basicData, starsData),
    ...basicIndicatorResult.definitions,
    ...listShopStarIndicatorScoreMetrics(shopStarIndicatorScores.scores),
    ...listServiceProductMetrics(basicData)
  ];
  const zeroDataMetrics = metricDefinitions
    .filter((metricDefinition) => metricDefinition.zeroData)
    .map((metricDefinition) => metricDefinition.metricName);
  return {
    records: metricDefinitions.map((metricDefinition) => createShopStarRecord(store, {
      ...metricDefinition,
      dataDate,
      collectedAt
    })),
    skipped: [],
    zeroDataMetrics,
    protocol: normalizedShopStarData?.protocol || "empty"
  };
}

module.exports = {
  resolveWindowDates,
  listBasicIndicatorMetrics,
  listShopStarIndicatorScoreMetrics,
  listSummaryMetrics,
  listServiceProductMetrics,
  readJsonResponse,
  createEmptyShopStarApiData,
  resolveShopStarPageDataDate,
  isShopStarDataUnavailableText,
  hasShopStarPageDataState,
  collectJdShopStarMetrics,
  ...shopStarProtocol,
  // 保留旧名称导出，便于现有测试和其他诊断脚本继续复用。
  basicApiToken,
  starsApiToken
};
