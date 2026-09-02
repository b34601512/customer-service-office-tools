// 该文件用于解决店铺报表配置整体验证问题。
const {
  clone,
  hasOwn,
  createEmptyReportProfile
} = require("./storeReportPrimitives");
const { getReportModule } = require("../reportModuleDefinitions");
const { validateReportProfileMetricMappings } = require("./metricMappingValidation");

function listReportProfileKeys(reportProfilesPayload, fallbackProfiles) {
  const keySet = new Set([
    ...Object.keys(fallbackProfiles || {}),
    ...Object.keys(reportProfilesPayload || {})
  ]);
  return Array.from(keySet).filter(Boolean);
}

function buildFallbackReportProfiles(fallbackStore) {
  const fallbackProfiles =
    fallbackStore?.reportProfiles && typeof fallbackStore.reportProfiles === "object"
      ? clone(fallbackStore.reportProfiles)
      : {};

  if (!fallbackProfiles.performance) {
    fallbackProfiles.performance = createEmptyReportProfile("performance");
  }

  return fallbackProfiles;
}

function resolveReportDisplayName(reportKey, payloadProfile, fallbackProfile, normalizeString) {
  // 指标名是系统统一文案，不从历史配置继承乱码或人为漂移。
  const reportModule = getReportModule(reportKey);
  return normalizeString(reportModule.displayName || payloadProfile?.displayName || fallbackProfile.displayName || reportKey);
}

function validateStoreReportProfiles(
  reportProfilesPayload,
  fallbackStore,
  label,
  normalizeString,
  normalizeColumnRef,
  normalizeBoolean
) {
  const fallbackProfiles = buildFallbackReportProfiles(fallbackStore);
  const payloadProfiles =
    reportProfilesPayload && typeof reportProfilesPayload === "object" && !Array.isArray(reportProfilesPayload)
      ? reportProfilesPayload
      : {};
  const profileKeys = listReportProfileKeys(payloadProfiles, fallbackProfiles);
  const normalizedProfiles = {};

  profileKeys.forEach((reportKey) => {
    const payloadProfile = payloadProfiles[reportKey] || {};
    const fallbackProfile = fallbackProfiles[reportKey] || createEmptyReportProfile(reportKey);

    const enabled = normalizeBoolean(
      hasOwn(payloadProfile, "enabled") ? payloadProfile.enabled : fallbackProfile.enabled,
      true
    );
    normalizedProfiles[reportKey] = {
      key: reportKey,
      displayName: resolveReportDisplayName(reportKey, payloadProfile, fallbackProfile, normalizeString),
      enabled,
      siteUrl: normalizeString(hasOwn(payloadProfile, "siteUrl") ? payloadProfile.siteUrl : fallbackProfile.siteUrl),
      downloadMode: normalizeString(
        hasOwn(payloadProfile, "downloadMode") ? payloadProfile.downloadMode : fallbackProfile.downloadMode
      ),
      sourceSheetMode: normalizeString(
        hasOwn(payloadProfile, "sourceSheetMode")
          ? payloadProfile.sourceSheetMode
          : fallbackProfile.sourceSheetMode || "single_sheet"
      ),
      sourceSheetName: normalizeString(
        hasOwn(payloadProfile, "sourceSheetName") ? payloadProfile.sourceSheetName : fallbackProfile.sourceSheetName
      ),
      sourceSheetIndex: Number.isInteger(Number(payloadProfile?.sourceSheetIndex))
        ? Number(payloadProfile.sourceSheetIndex)
        : Number.isInteger(Number(fallbackProfile.sourceSheetIndex))
          ? Number(fallbackProfile.sourceSheetIndex)
          : 0,
      sourceAliasFieldLabel: normalizeString(
        hasOwn(payloadProfile, "sourceAliasFieldLabel")
          ? payloadProfile.sourceAliasFieldLabel
          : fallbackProfile.sourceAliasFieldLabel
      ),
      metricMappings: enabled
        ? validateReportProfileMetricMappings(
            payloadProfile,
            fallbackProfile,
            `${label} 报表「${reportKey}」配置`,
            normalizeString
          )
        : Array.isArray(fallbackProfile.metricMappings) ? fallbackProfile.metricMappings : []
    };
  });

  return normalizedProfiles;
}

module.exports = {
  validateStoreReportProfiles
};
