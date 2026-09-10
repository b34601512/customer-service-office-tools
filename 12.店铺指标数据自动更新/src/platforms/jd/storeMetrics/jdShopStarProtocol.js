// 京东店铺星级接口协议层：只负责识别接口、区分协议和把新版字段映射到统一快照。
// 浏览器导航、页面文字和写表逻辑放在 jdShopStarMetricCollector.js。

const jdShopStarApiNames = Object.freeze({
  basic: "dsm.shop.vane.view.core.export.ohs.stars.service.VaneBasicFacade.queryVaneBasic",
  stars: "dsm.shop.vane.view.core.export.ohs.stars.service.VaneStarsFacade",
  degradation: "dsm.shop.vane.view.core.export.ohs.stars.service.VaneDegradationFacade.queryDegradationInfo",
  prejudgment: "dsm.shop.vane.view.core.export.ohs.stars.service.VanePrejudgmentFacade.queryVanePrejudgment"
});

const jdShopStarRequiredApiNames = new Set([
  jdShopStarApiNames.basic,
  jdShopStarApiNames.stars
]);

// 这些接口只提供页面辅助信息，不能阻断主星级数据采集，也不能单独触发风控接管。
const jdShopStarOptionalApiNames = new Set([
  jdShopStarApiNames.degradation,
  jdShopStarApiNames.prejudgment
]);

const shopStarEmptyResponseCodes = Object.freeze([601]);

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

function isModernShopStarData(data) {
  return isJsonObject(data) &&
    (hasMeaningfulValue(data.scoreRankRateGrade) || hasMeaningfulValue(data.hScoreRankRateGrade)) &&
    hasShopStarStarsData(data);
}

function getShopStarProtocol(results) {
  if (!results) return "";
  if (!results.starsResult?.empty && isModernShopStarData(results.starsResult.data)) return "modern";
  if (
    !results.basicResult?.empty &&
    !results.starsResult?.empty &&
    hasShopStarBasicData(results.basicResult.data) &&
    hasShopStarStarsData(results.starsResult.data)
  ) return "legacy";
  return "";
}

function hasCompleteShopStarApiData(results) {
  return Boolean(getShopStarProtocol(results));
}

function normalizeShopStarApiData(results, dataDate = "") {
  const protocol = getShopStarProtocol(results);
  if (!protocol) return null;

  if (protocol === "modern") {
    const modernData = results.starsResult.data;
    // 统一快照只保留星级指标映射所需字段，不伪造新版没有返回的明细指标。
    return {
      protocol,
      dataDate: String(dataDate || ""),
      basicData: {
        opTime: String(dataDate || ""),
        validOrderNum: modernData.validOrderNum,
        zbs: {
          Vane_ScoreRankRate: {
            pji: modernData.scoreRankRateGrade ?? modernData.hScoreRankRateGrade,
            rank: modernData.scoreRankRate
          }
        }
      },
      starsData: modernData
    };
  }

  return {
    protocol,
    dataDate: String(dataDate || results.basicResult.data.opTime || ""),
    basicData: results.basicResult.data,
    starsData: results.starsResult.data
  };
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

function isRequiredShopStarApi(apiName) {
  return jdShopStarRequiredApiNames.has(String(apiName || ""));
}

module.exports = {
  jdShopStarApiNames,
  jdShopStarRequiredApiNames,
  jdShopStarOptionalApiNames,
  shopStarEmptyResponseCodes,
  hasJsonResponseData,
  hasMeaningfulValue,
  isJsonObject,
  hasShopStarBasicData,
  hasShopStarStarsData,
  isModernShopStarData,
  getShopStarProtocol,
  hasCompleteShopStarApiData,
  normalizeShopStarApiData,
  resolveJdApiName,
  isShopStarApiResponse,
  isRequiredShopStarApi
};
