const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const {
  readJdMetricPageText,
  readMetricValue
} = require("./jdMetricText");
const { checkBrowserHumanRequirement } = require("../../../engine/browserHumanGuard");
const { requireHeadedBrowser } = require("../../../engine/browserAutomationScope");
const { formatDate, shiftDateText } = require("../../../shared/exportDateRange");

const jdShopStarApiNames = {
  basic: "dsm.shop.vane.view.core.export.ohs.stars.service.VaneBasicFacade.queryVaneBasic",
  stars: "dsm.shop.vane.view.core.export.ohs.stars.service.VaneStarsFacade",
  degradation: "dsm.shop.vane.view.core.export.ohs.stars.service.VaneDegradationFacade.queryDegradationInfo",
  prejudgment: "dsm.shop.vane.view.core.export.ohs.stars.service.VanePrejudgmentFacade.queryVanePrejudgment"
};
const basicApiToken = jdShopStarApiNames.basic;
const starsApiToken = jdShopStarApiNames.stars;
const jdShopStarRateLimitApiNames = new Set(Object.values(jdShopStarApiNames));
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
const shopStarEmptyResponseCodes = [601];
const shopStarLoadTimeoutMilliseconds = 60000;
const shopStarLateResponseWaitMilliseconds = 20000;
const shopStarEmptyConfirmationMilliseconds = 20000;
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

function hasJsonResponseData(data) {
  if (data === null || data === undefined) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === "object") return Object.keys(data).length > 0;
  return true;
}

function hasMeaningfulValue(value) {
  return value !== null && value !== undefined &&
    !(typeof value === "string" && !value.trim());
}

function isJsonObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasShopStarBasicData(data) {
  return isJsonObject(data) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(data.opTime || "")) &&
    isJsonObject(data.zbs) && Object.keys(data.zbs).length > 0 &&
    (hasMeaningfulValue(data.finalScore) || hasMeaningfulValue(data.validOrderNum));
}

function hasShopStarStarsData(data) {
  return isJsonObject(data) &&
    (hasMeaningfulValue(data.venderId) || hasMeaningfulValue(data.shopName));
}

function hasCompleteShopStarApiData(results) {
  return Boolean(results) &&
    !results.basicResult?.empty &&
    !results.starsResult?.empty &&
    hasShopStarBasicData(results.basicResult?.data) &&
    hasShopStarStarsData(results.starsResult?.data);
}

function resolveJdApiName(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).searchParams.get("api") || "";
  } catch {
    return "";
  }
}

function isShopStarApiResponse(response, apiName) {
  if (!response || typeof response.url !== "function") return false;
  const request = typeof response.request === "function" ? response.request() : null;
  const resourceType = typeof request?.resourceType === "function" ? request.resourceType() : "";
  return ["xhr", "fetch"].includes(resourceType) && resolveJdApiName(response.url()) === apiName;
}

function createShopStarRateLimitMonitor(page) {
  let disposed = false;
  let state = null;
  let resolveDetection;
  let detectionPromise = new Promise((resolve) => {
    resolveDetection = resolve;
  });

  const detect = (details = {}) => {
    if (disposed || state) return;
    state = {
      apiName: String(details.apiName || ""),
      message: String(details.message || "京东接口请求繁忙（code=601）")
    };
    resolveDetection(state);
  };

  const onResponse = (response) => {
    const apiName = resolveJdApiName(response.url());
    if (!jdShopStarRateLimitApiNames.has(apiName)) return;
    Promise.resolve(response.json())
      .then((payload) => {
        if (Number(payload?.code) === 601) {
          detect({
            apiName,
            message: String(payload?.msg || payload?.message || "京东接口请求繁忙（code=601）")
          });
        }
      })
      .catch(() => {});
  };
  const onPageError = (error) => {
    const message = String(error?.message || error || "");
    if (/(?:\b601\b|请求繁忙|操作频繁)/.test(message)) {
      detect({ message });
    }
  };

  page.on("response", onResponse);
  page.on("pageerror", onPageError);

  return {
    getState: () => state,
    waitForDetection: () => (state ? Promise.resolve(state) : detectionPromise),
    reset() {
      if (disposed) return;
      state = null;
      detectionPromise = new Promise((resolve) => {
        resolveDetection = resolve;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.off?.("response", onResponse);
      page.off?.("pageerror", onPageError);
      resolveDetection(null);
    }
  };
}

function handleShopStarRateLimit(rateLimitMonitor, results = null) {
  const rateLimitState = rateLimitMonitor?.getState?.();
  const resultCode = [results?.basicResult?.code, results?.starsResult?.code]
    .find((code) => Number(code) === 601);
  if (!rateLimitState && resultCode === undefined) return false;
  const reason = rateLimitState?.message || "京东店铺星级接口返回请求繁忙（code=601）";
  requireHeadedBrowser(`${reason}，正在切换可见 Edge 重试`);
  return true;
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

async function waitForShopStarRateLimitRetry(page, rateLimitMonitor, deadline) {
  const remainingMilliseconds = Math.max(0, deadline - Date.now());
  if (remainingMilliseconds > 0) {
    await page.waitForTimeout(Math.min(shopStarRateLimitWaitMilliseconds, remainingMilliseconds));
  }
  rateLimitMonitor.reset();
}

async function readShopStarResponsePairOrRateLimit(page, timeoutMilliseconds, rateLimitMonitor) {
  const responsePairPromise = readShopStarResponsePair(page, timeoutMilliseconds);
  const outcome = await Promise.race([
    responsePairPromise.then((results) => ({ type: "responses", results })),
    rateLimitMonitor.waitForDetection().then((rateLimit) => ({ type: "rate-limit", rateLimit }))
  ]);
  return outcome;
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

async function waitForShopStarPageDataState(page, timeoutMilliseconds = 60000) {
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

function waitForShopStarResponse(page, apiToken, timeoutMilliseconds = 60000) {
  return page.waitForResponse(
    (response) => isShopStarApiResponse(response, apiToken),
    { timeout: timeoutMilliseconds }
  );
}

async function readShopStarResponsePair(page, timeoutMilliseconds) {
  const basicResponsePromise = waitForShopStarResponse(page, basicApiToken, timeoutMilliseconds);
  const starsResponsePromise = waitForShopStarResponse(page, starsApiToken, timeoutMilliseconds);
  const [basicResult, starsResult] = await Promise.all([
    readJsonResponse(basicResponsePromise, "星级指标", {
      allowEmptyData: true,
      allowEmptyResponseCodes: shopStarEmptyResponseCodes
    }),
    readJsonResponse(starsResponsePromise, "星级汇总", {
      allowEmptyData: true,
      allowEmptyResponseCodes: shopStarEmptyResponseCodes
    })
  ]);
  return { basicResult, starsResult };
}

async function waitForShopStarApiData(page, shopStarUrl, timeoutMilliseconds = shopStarLoadTimeoutMilliseconds) {
  const rateLimitMonitor = createShopStarRateLimitMonitor(page);
  try {
    return await waitForShopStarApiDataWithMonitor(
      page,
      shopStarUrl,
      timeoutMilliseconds,
      rateLimitMonitor
    );
  } finally {
    rateLimitMonitor.dispose();
  }
}

async function waitForShopStarApiDataWithMonitor(
  page,
  shopStarUrl,
  timeoutMilliseconds,
  rateLimitMonitor
) {
  const deadline = Date.now() + timeoutMilliseconds;
  let attempt = 0;
  let navigate = true;
  let latestResults = null;
  let latestPageText = "";
  let emptyStartedAt = 0;
  let lastError = null;

  while (Date.now() <= deadline) {
    await checkBrowserHumanRequirement({ includeLogin: true });
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) break;
    try {
      if (navigate) {
        const responsePairOutcome = readShopStarResponsePairOrRateLimit(
          page,
          Math.min(45000, remainingMilliseconds),
          rateLimitMonitor
        );
        responsePairOutcome.catch(() => {});
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
        const outcome = await responsePairOutcome;
        if (outcome.type === "rate-limit") {
          handleShopStarRateLimit(rateLimitMonitor);
          await waitForShopStarRateLimitRetry(page, rateLimitMonitor, deadline);
          latestResults = null;
          latestPageText = "";
          navigate = true;
          attempt += 1;
          continue;
        }
        latestResults = outcome.results;
      } else {
        // 首次响应可能只是页面初始化占位结果；不立刻判空，先接住页面后续补发的真实响应。
        const outcome = await readShopStarResponsePairOrRateLimit(
          page,
          Math.min(shopStarLateResponseWaitMilliseconds, remainingMilliseconds),
          rateLimitMonitor
        );
        if (outcome.type === "rate-limit") {
          handleShopStarRateLimit(rateLimitMonitor);
          await waitForShopStarRateLimitRetry(page, rateLimitMonitor, deadline);
          latestResults = null;
          latestPageText = "";
          navigate = true;
          attempt += 1;
          continue;
        }
        latestResults = outcome.results;
      }
      if (handleShopStarRateLimit(rateLimitMonitor, latestResults)) {
        await waitForShopStarRateLimitRetry(page, rateLimitMonitor, deadline);
        latestResults = null;
        latestPageText = "";
        navigate = true;
        attempt += 1;
        continue;
      }
    } catch (error) {
      lastError = error;
      if (handleShopStarRateLimit(rateLimitMonitor, latestResults)) {
        await waitForShopStarRateLimitRetry(page, rateLimitMonitor, deadline);
        latestResults = null;
        latestPageText = "";
        navigate = true;
        attempt += 1;
        continue;
      }
      latestPageText = await readJdMetricPageText(page).catch(() => latestPageText);
      if (
        latestResults &&
        isShopStarDataUnavailableText(latestPageText) &&
        emptyStartedAt &&
        Date.now() - emptyStartedAt >= shopStarEmptyConfirmationMilliseconds
      ) {
        return { ...latestResults, pageText: latestPageText };
      }
      if (Date.now() >= deadline) break;
      navigate = true;
      attempt += 1;
      continue;
    }

    const hasCompleteApiData = hasCompleteShopStarApiData(latestResults);
    if (hasCompleteApiData) {
      // API 已返回完整业务对象时，以接口为准；页面文字只等待短时间用于凭证和人工可读指标。
      latestPageText = await waitForShopStarPageDataState(
        page,
        Math.min(5000, Math.max(1000, deadline - Date.now()))
      ).catch(() => readJdMetricPageText(page).catch(() => latestPageText));
      return { ...latestResults, pageText: latestPageText };
    }

    try {
      latestPageText = await waitForShopStarPageDataState(
        page,
        Math.min(15000, Math.max(1000, deadline - Date.now()))
      );
    } catch (error) {
      lastError = error;
      navigate = false;
      continue;
    }

    if (!emptyStartedAt) emptyStartedAt = Date.now();
    if (
      isShopStarDataUnavailableText(latestPageText) &&
      Date.now() - emptyStartedAt >= shopStarEmptyConfirmationMilliseconds
    ) {
      return { ...latestResults, pageText: latestPageText };
    }
    if (Date.now() >= deadline) break;

    // 先等待页面自身的异步补发；若仍无真实数据，再完整刷新一次触发接口重试。
    navigate = false;
  }

  latestPageText = await readJdMetricPageText(page).catch(() => latestPageText);
  if (latestResults && isShopStarDataUnavailableText(latestPageText)) {
    return { ...latestResults, pageText: latestPageText };
  }
  if (isShopStarDataUnavailableText(latestPageText)) {
    // 只有完整等待窗口结束且页面仍明确显示“当前星级暂无”时，才按无数据继续，避免覆盖延迟返回的真实数据。
    return createEmptyShopStarApiData(latestPageText, latestResults);
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
  const hasValue = rawValue !== null && rawValue !== undefined &&
    !(typeof rawValue === "string" && !rawValue.trim()) &&
    Number.isFinite(numericValue);
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
    const requestBody = JSON.parse(result.response.request().postData() || "{}");
    if (String(requestBody?.vaneBasicParam?.date || "") !== snapshotDate) {
      throw new Error(`店铺星级手动日期未生效：期望 ${snapshotDate}。`);
    }
    latestResult = result;
    if (!result.empty) return result;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(Math.min(shopStarLateResponseWaitMilliseconds, deadline - Date.now()));
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

async function collectJdShopStarMetrics(page, store, dateSelection) {
  const initialShopStarData = await waitForShopStarApiData(page, store.sources.shopStar);
  const initialShopStarPageText = initialShopStarData.pageText;
  const starsResult = initialShopStarData.starsResult;
  const basicResult = dateSelection.snapshotDate
    ? await applyManualShopStarDate(page, dateSelection.snapshotDate)
    : initialShopStarData.basicResult;
  const requestBody = JSON.parse(basicResult.response.request().postData() || "{}");
  const shopStarPageText = dateSelection.snapshotDate
    ? await waitForShopStarPageDataState(page)
    : initialShopStarPageText;
  const shopStarDataUnavailable = isShopStarDataUnavailableText(shopStarPageText);
  const emptyResponseLabels = [
    starsResult.empty ? "星级汇总" : "",
    basicResult.empty ? "星级指标" : ""
  ].filter(Boolean);
  if (emptyResponseLabels.length && !shopStarDataUnavailable) {
    throw new Error(
      `京东店铺星级接口返回空数据：${emptyResponseLabels.join("、")}，但页面未确认当前星级无数据。`
    );
  }
  const pageDataDate = resolveShopStarPageDataDate(shopStarPageText || initialShopStarPageText);
  const dataDate = String(
    basicResult.data.opTime ||
    (basicResult.empty ? "" : requestBody?.vaneBasicParam?.date) ||
    pageDataDate ||
    formatDate(new Date())
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDate)) {
    throw new Error("京东店铺星级没有返回真实数据日期。");
  }
  const shopStarIndicatorScores = await readShopStarIndicatorScores(page, shopStarPageText, basicResult.data);
  const collectedAt = new Date().toISOString();
  const basicIndicatorResult = listBasicIndicatorMetrics(basicResult.data);
  const metricDefinitions = [
    ...listSummaryMetrics(basicResult.data, starsResult.data),
    ...basicIndicatorResult.definitions,
    ...listShopStarIndicatorScoreMetrics(shopStarIndicatorScores.scores),
    ...listServiceProductMetrics(basicResult.data)
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
    zeroDataMetrics
  };
}

module.exports = {
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
  collectJdShopStarMetrics
};
