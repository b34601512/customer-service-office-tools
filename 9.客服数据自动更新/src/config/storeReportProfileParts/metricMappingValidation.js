// 该文件用于解决报表指标映射配置校验问题。
function validateReportMetricMapping(metricMapping, fallbackMetricMapping, label, normalizeString) {
  const preferredFieldLabel = normalizeString(
    metricMapping?.sourceFieldLabel || fallbackMetricMapping?.sourceFieldLabel
  );
  const nextMetricMapping = {
    key: normalizeString(metricMapping?.key || fallbackMetricMapping?.key),
    sourceFieldLabel: preferredFieldLabel
  };

  if (!nextMetricMapping.key) {
    throw new Error(`${label} 缺少指标标识。`);
  }
  if (!nextMetricMapping.sourceFieldLabel) {
    throw new Error(`${label} 缺少源字段说明。`);
  }

  return nextMetricMapping;
}

function mergeReportMetricMappingsWithFallbacks(payloadMetricMappings, fallbackMetricMappings, normalizeString) {
  // 该函数只把新版新增的官方指标补到历史配置末尾，已有映射仍以用户当前配置为准。
  const preferredMetricMappings = Array.isArray(payloadMetricMappings)
    ? payloadMetricMappings
    : fallbackMetricMappings;
  const existingMetricKeys = new Set(
    preferredMetricMappings.map((metricMapping) => normalizeString(metricMapping?.key)).filter(Boolean)
  );
  const missingFallbackMetricMappings = fallbackMetricMappings.filter((metricMapping) => {
    const metricKey = normalizeString(metricMapping?.key);
    return metricKey && !existingMetricKeys.has(metricKey);
  });
  return [...preferredMetricMappings, ...missingFallbackMetricMappings];
}

function validateReportProfileMetricMappings(reportProfilePayload, fallbackReportProfile, label, normalizeString) {
  const fallbackMetricMappings = Array.isArray(fallbackReportProfile?.metricMappings)
    ? fallbackReportProfile.metricMappings
    : [];
  const payloadMetricMappings = mergeReportMetricMappingsWithFallbacks(
    reportProfilePayload?.metricMappings,
    fallbackMetricMappings,
    normalizeString
  );
  const normalizedMetricMappings = payloadMetricMappings.map((metricMapping, index) =>
    validateReportMetricMapping(
      metricMapping,
      fallbackMetricMappings.find(
        (fallbackMetricMapping) =>
          normalizeString(fallbackMetricMapping?.key) === normalizeString(metricMapping?.key)
      ) || fallbackMetricMappings[index] || {},
      `${label} 第 ${index + 1} 个指标映射`,
      normalizeString
    )
  );
  const seenMetricKeys = new Set();

  normalizedMetricMappings.forEach((metricMapping) => {
    if (seenMetricKeys.has(metricMapping.key)) {
      throw new Error(`${label} 存在重复指标标识：${metricMapping.key}`);
    }
    seenMetricKeys.add(metricMapping.key);
  });

  if (!normalizedMetricMappings.length) {
    throw new Error(`${label} 至少需要一个指标映射。`);
  }

  return normalizedMetricMappings;
}

module.exports = {
  mergeReportMetricMappingsWithFallbacks,
  validateReportProfileMetricMappings
};
