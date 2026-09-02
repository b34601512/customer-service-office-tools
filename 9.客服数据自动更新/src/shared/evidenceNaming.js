function normalizeEvidenceNamePart(value, fallbackValue = "unknown") {
  const normalizedValue = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return String(normalizedValue || fallbackValue).slice(0, 60);
}

function formatEvidenceTimestamp(dateValue = new Date()) {
  const evidenceDate = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(evidenceDate.getTime())) {
    throw new Error("凭证时间无效。 ");
  }
  const dateParts = [
    evidenceDate.getFullYear(),
    String(evidenceDate.getMonth() + 1).padStart(2, "0"),
    String(evidenceDate.getDate()).padStart(2, "0")
  ];
  const timeParts = [
    String(evidenceDate.getHours()).padStart(2, "0"),
    String(evidenceDate.getMinutes()).padStart(2, "0"),
    String(evidenceDate.getSeconds()).padStart(2, "0")
  ];
  const millisecondsText = String(evidenceDate.getMilliseconds()).padStart(3, "0");
  return `${dateParts.join("-")}_${timeParts.join("-")}-${millisecondsText}`;
}

function buildEvidenceStoreFolderName({ storeDisplayName = "", storeKey = "" } = {}) {
  const displayNamePart = normalizeEvidenceNamePart(storeDisplayName || storeKey, "未知店铺");
  const storeKeyPart = normalizeEvidenceNamePart(storeKey, "");
  if (!storeKeyPart || storeKeyPart.toLowerCase() === displayNamePart.toLowerCase()) {
    return displayNamePart;
  }
  return `${displayNamePart}_${storeKeyPart}`;
}

function buildEvidenceScopeName({ platformLabel = "", platformKey = "", storeDisplayName = "", storeKey = "" } = {}) {
  const platformNamePart = normalizeEvidenceNamePart(platformLabel || platformKey, "未知平台");
  const storeNamePart = normalizeEvidenceNamePart(storeDisplayName || storeKey, "未知店铺");
  return `${platformNamePart}_${storeNamePart}`;
}

function buildEvidenceFileName({
  createdAt = new Date(),
  fileNamePrefix = "",
  evidenceLabel = "下载凭证",
  extension = ".png"
} = {}) {
  const normalizedPrefix = fileNamePrefix
    ? `${normalizeEvidenceNamePart(fileNamePrefix)}_`
    : "";
  const normalizedLabel = normalizeEvidenceNamePart(evidenceLabel, "下载凭证");
  const normalizedExtension = String(extension || ".png").startsWith(".")
    ? String(extension || ".png")
    : `.${String(extension)}`;
  return `${formatEvidenceTimestamp(createdAt)}_${normalizedPrefix}${normalizedLabel}${normalizedExtension}`;
}

module.exports = {
  normalizeEvidenceNamePart,
  formatEvidenceTimestamp,
  buildEvidenceStoreFolderName,
  buildEvidenceScopeName,
  buildEvidenceFileName
};
