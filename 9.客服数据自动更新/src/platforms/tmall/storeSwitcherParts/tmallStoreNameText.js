// 该文件用于解决天猫店铺名称规范化和目标店铺名解析问题。
// escapeRegex 统一取自 shared/visibleButtonActionEngine 单一真源（#603）。
const { escapeRegex } = require("../../../shared/visibleButtonActionEngine");

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTmallShopName(value) {
  // 这里把页面店铺名和配置店铺名压成同一格式，避免大小写、空格、主店/分店后缀干扰比对。
  return String(value || "")
    .replace(/[:：].*$/, "")
    .replace(/\s+/g, "")
    .replace(/(主店|分店)$/g, "")
    .toLowerCase()
    .trim();
}

function buildTmallStoreOptionPattern(expectedShopNames) {
  return new RegExp(expectedShopNames.map((item) => escapeRegex(item)).join("|"), "i");
}

function resolveExpectedTmallShopNames(storeConfig) {
  // 这里优先使用账号字段里的“店铺名:账号人”前缀作为真实店铺名，再退回店铺展示名。
  const rawCandidates = [
    String(storeConfig?.username || "").split(/[:：]/)[0],
    storeConfig?.displayName
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  const normalizedSet = new Set();
  return rawCandidates.filter((item) => {
    const normalized = normalizeTmallShopName(item);
    if (!normalized || normalizedSet.has(normalized)) {
      return false;
    }

    normalizedSet.add(normalized);
    return true;
  });
}

function isExpectedTmallShop(currentShopName, expectedShopNames) {
  // 这里统一判断当前浏览器店铺是否已经是目标店铺，后续状态确认和自动切店都复用。
  const normalizedCurrent = normalizeTmallShopName(currentShopName);
  if (!normalizedCurrent) {
    return false;
  }

  return expectedShopNames.some((item) => {
    const normalizedExpected = normalizeTmallShopName(item);
    return (
      normalizedExpected &&
      (normalizedCurrent.includes(normalizedExpected) || normalizedExpected.includes(normalizedCurrent))
    );
  });
}

module.exports = {
  escapeRegex,
  normalizeInlineText,
  normalizeTmallShopName,
  buildTmallStoreOptionPattern,
  resolveExpectedTmallShopNames,
  isExpectedTmallShop
};
