function normalizeJdMetricText(value) {
  // 这个函数只移除指标文字中的空白以便页面字段比较。
  return String(value || "").replace(/\s+/g, "").trim();
}

function resolveRequiredJdSystemMetricLabels(resolvedConfig) {
  // 这个函数只从当前下载任务解析唯一必选源字段名。
  const metricMappings = Array.isArray(resolvedConfig?.activeStore?.downloadRequiredMetricMappings)
    ? resolvedConfig.activeStore.downloadRequiredMetricMappings
    : Array.isArray(resolvedConfig?.activeStore?.metricMappings)
      ? resolvedConfig.activeStore.metricMappings
      : [];
  return [...new Set(
    metricMappings
      .map((mapping) => String(mapping?.sourceFieldLabel || "").trim())
      .filter(Boolean)
  )];
}

function findMissingJdMetricLabels(surfaceText, requiredMetricLabels) {
  // 这个函数只计算页面文本中尚未出现的必选指标名。
  const normalizedSurfaceText = normalizeJdMetricText(surfaceText);
  return requiredMetricLabels.filter((label) => !normalizedSurfaceText.includes(normalizeJdMetricText(label)));
}

module.exports = {
  resolveRequiredJdSystemMetricLabels,
  findMissingJdMetricLabels
};
