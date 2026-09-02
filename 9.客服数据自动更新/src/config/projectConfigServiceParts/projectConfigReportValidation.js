// 该文件只负责校验并规范化平台报表来源、支持范围和人员映射。
const {
  getPlatformReportRule,
  getPlatformReportDefaultSource
} = require("../platformReportRuleParts/platformReportRuleService");
const { normalizeString } = require("./projectConfigValuePrimitives");

function isPlatformReportSupported(platformKey, reportKey, reportProfile) {
  // 这里从源头定义平台支持范围，未接入的报表不参与启用和字段映射校验。
  const normalizedReportKey = normalizeString(reportKey);
  if (normalizedReportKey === "performance") {
    return Boolean(getPlatformReportRule(platformKey, "performance", normalizeString(reportProfile?.downloadMode)));
  }

  const defaultSource = getPlatformReportDefaultSource(platformKey, normalizedReportKey);
  const effectiveDownloadMode = normalizeString(defaultSource?.downloadMode || reportProfile?.downloadMode);
  return Boolean(getPlatformReportRule(platformKey, normalizedReportKey, effectiveDownloadMode));
}

function validateOfficialReportSources(platformKey, storePayload, storeLabel) {
  // 该函数拒绝配置里明确提交的旧来源，避免废弃模式被静默改写后继续潜伏。
  const payloadProfiles =
    storePayload?.reportProfiles && typeof storePayload.reportProfiles === "object" && !Array.isArray(storePayload.reportProfiles)
      ? storePayload.reportProfiles
      : {};

  Object.entries(payloadProfiles).forEach(([reportKey, reportProfile]) => {
    const officialSource = getPlatformReportDefaultSource(platformKey, reportKey);
    const submittedDownloadMode = normalizeString(reportProfile?.downloadMode);
    if (!officialSource || !submittedDownloadMode || submittedDownloadMode === officialSource.downloadMode) {
      return;
    }

    throw new Error(
      `${storeLabel} 报表「${reportKey}」下载来源“${submittedDownloadMode}”已废弃或不受支持，当前官方来源为“${officialSource.downloadMode}”。`
    );
  });
}

function forceUnsupportedReportProfilesDisabled(platformKey, storePayload, fallbackStore) {
  // 这里在正式校验前先禁用平台不支持的报表，避免抖音业绩、拼多多满意度等无来源报表误触字段校验。
  const payloadProfiles =
    storePayload?.reportProfiles && typeof storePayload.reportProfiles === "object" && !Array.isArray(storePayload.reportProfiles)
      ? storePayload.reportProfiles
      : {};
  const fallbackProfiles =
    fallbackStore?.reportProfiles && typeof fallbackStore.reportProfiles === "object" && !Array.isArray(fallbackStore.reportProfiles)
      ? fallbackStore.reportProfiles
      : {};
  const normalizedProfiles = { ...payloadProfiles };

  new Set([...Object.keys(fallbackProfiles), ...Object.keys(payloadProfiles)]).forEach((reportKey) => {
    const payloadProfile = payloadProfiles[reportKey] || {};
    const fallbackProfile = fallbackProfiles[reportKey] || {};
    const effectiveProfile = { ...fallbackProfile, ...payloadProfile };
    if (!isPlatformReportSupported(platformKey, reportKey, effectiveProfile)) {
      normalizedProfiles[reportKey] = {
        ...payloadProfile,
        enabled: false
      };
    }
  });

  return {
    ...(storePayload || {}),
    reportProfiles: normalizedProfiles
  };
}

module.exports = {
  validateOfficialReportSources,
  forceUnsupportedReportProfilesDisabled
};
