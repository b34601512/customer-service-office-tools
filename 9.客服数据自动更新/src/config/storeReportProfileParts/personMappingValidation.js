// 该文件用于解决报表姓名匹配配置校验问题。
const { normalizeSourceNames } = require("./storeReportPrimitives");

function validatePersonMapping(mapping, label, normalizeString) {
  const summaryName = normalizeString(mapping?.summaryName);
  const role = normalizeString(mapping?.role);
  const sourceNames = normalizeSourceNames(mapping?.sourceNames)
    .map((item) => normalizeString(item))
    .filter(Boolean);
  const uniqueSourceNames = Array.from(new Set(sourceNames));

  if (!summaryName) {
    throw new Error(`${label} 缺少汇总姓名。`);
  }

  if (!["售前", "售后"].includes(role)) {
    throw new Error(`${label} 必须选择岗位：售前或售后。`);
  }

  if (!uniqueSourceNames.length) {
    throw new Error(`${label} 至少需要一个后台账号或别名。`);
  }

  return {
    summaryName,
    role,
    sourceNames: uniqueSourceNames
  };
}

function validatePersonMappings(personMappingsPayload, fallbackPersonMappings, label, normalizeString) {
  const payloadMappings = Array.isArray(personMappingsPayload) ? personMappingsPayload : fallbackPersonMappings || [];
  const nonEmptyPayloadMappings = payloadMappings.filter((mapping) => {
    const summaryName = normalizeString(mapping?.summaryName);
    const sourceNames = normalizeSourceNames(mapping?.sourceNames).map((item) => normalizeString(item)).filter(Boolean);
    return Boolean(summaryName || sourceNames.length);
  });
  const normalizedMappings = nonEmptyPayloadMappings.map((mapping, index) =>
    validatePersonMapping(mapping, `${label} 第 ${index + 1} 个姓名匹配`, normalizeString)
  );
  const summaryNameToMapping = new Map();
  const sourceNameToSummary = new Map();

  normalizedMappings.forEach((mapping) => {
    const existingMapping = summaryNameToMapping.get(mapping.summaryName);
    if (existingMapping && existingMapping.role !== mapping.role) {
      throw new Error(`${label} 的姓名「${mapping.summaryName}」岗位不一致：只能选择一个岗位。`);
    }
    const mergedMapping = existingMapping || {
      summaryName: mapping.summaryName,
      role: mapping.role,
      sourceNames: []
    };

    mapping.sourceNames.forEach((sourceName) => {
      const existingSummaryName = sourceNameToSummary.get(sourceName);
      if (existingSummaryName === mapping.summaryName) {
        throw new Error(`${label} 存在重复配置：姓名「${mapping.summaryName}」与店铺账号名称「${sourceName}」已添加。`);
      }
      if (existingSummaryName && existingSummaryName !== mapping.summaryName) {
        throw new Error(
          `${label} 的后台账号或别名「${sourceName}」被同时映射到「${existingSummaryName}」和「${mapping.summaryName}」。`
        );
      }
      sourceNameToSummary.set(sourceName, mapping.summaryName);
      mergedMapping.sourceNames.push(sourceName);
    });
    summaryNameToMapping.set(mapping.summaryName, mergedMapping);
  });

  return Array.from(summaryNameToMapping.values());
}

module.exports = {
  validatePersonMapping,
  validatePersonMappings
};
