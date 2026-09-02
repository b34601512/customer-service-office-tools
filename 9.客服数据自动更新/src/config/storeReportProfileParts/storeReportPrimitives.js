// 该文件用于解决报表配置的基础工具和最小骨架问题。
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasOwn(target, key) {
  return Boolean(target) && Object.prototype.hasOwnProperty.call(target, key);
}

function normalizeSourceNames(sourceNamesPayload) {
  if (Array.isArray(sourceNamesPayload)) {
    return sourceNamesPayload;
  }

  if (typeof sourceNamesPayload === "string") {
    return sourceNamesPayload
      .split(/[|｜,，、]/)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  return [];
}

function createEmptyReportProfile(reportKey = "performance") {
  // 这里集中定义报表配置的最小骨架，避免各处各写一份默认值。
  return {
    key: reportKey,
    displayName: reportKey === "performance" ? "业绩指标" : reportKey,
    enabled: true,
    siteUrl: "",
    downloadMode: "",
    sourceSheetMode: "single_sheet",
    sourceSheetName: "",
    sourceSheetIndex: 0,
    sourceAliasFieldLabel: "",
    metricMappings: []
  };
}

module.exports = {
  clone,
  hasOwn,
  normalizeSourceNames,
  createEmptyReportProfile
};
