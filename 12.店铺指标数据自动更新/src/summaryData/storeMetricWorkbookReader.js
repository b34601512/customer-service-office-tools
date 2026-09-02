const {
  loadXlsxArchive,
  resolveWorksheetArchivePath,
  readArchiveXml,
  loadSharedStringStore,
  readWorksheetRows
} = require("./xlsxWorkbookEngine");
const { dataSourceSheetName } = require("./storeMetricDataSourceSchema");
const {
  normalizeText,
  resolveHeaderColumns,
  readCell
} = require("./storeMetricHeaderColumns");
const { PLATFORM_SCOPE_DEFINITIONS } = require("../shared/storeCollectionScope");

// 平台中文名以 storeCollectionScope 的平台清单为唯一真源，这里只做形状转换。
const platformDisplayNames = Object.fromEntries(
  PLATFORM_SCOPE_DEFINITIONS.map(({ platformKey, platformName }) => [platformKey, platformName])
);
const requiredHeaders = ["平台", "店铺编号", "记录键"];

function resolvePlatformDisplayName(platformKey) {
  const normalizedPlatformKey = normalizeText(platformKey).toLowerCase();
  return platformDisplayNames[normalizedPlatformKey] || normalizedPlatformKey;
}

async function listStoreMetricRecordKeys({ workbookPath, platformKey, storeKey }) {
  const archive = await loadXlsxArchive(workbookPath);
  const sharedStringStore = await loadSharedStringStore(archive);
  const { worksheetPath } = await resolveWorksheetArchivePath(archive, "named_sheet", dataSourceSheetName);
  const worksheetDocument = await readArchiveXml(archive, worksheetPath);
  const worksheetRows = readWorksheetRows(worksheetDocument, sharedStringStore.values);
  const headerColumns = resolveHeaderColumns(worksheetRows.get(1) || new Map(), requiredHeaders);
  const expectedPlatform = resolvePlatformDisplayName(platformKey);
  const expectedStoreKey = normalizeText(storeKey);
  const recordKeys = [];
  for (const [rowNumber, cells] of worksheetRows.entries()) {
    if (rowNumber <= 1) continue;
    const rowPlatform = normalizeText(readCell(cells, headerColumns, "平台"));
    const rowStoreKey = normalizeText(readCell(cells, headerColumns, "店铺编号"));
    const recordKey = normalizeText(readCell(cells, headerColumns, "记录键"));
    if (rowPlatform === expectedPlatform && rowStoreKey === expectedStoreKey && recordKey) {
      recordKeys.push(recordKey);
    }
  }
  return recordKeys;
}

async function hasReusableStoreMetricData({ workbookPath, store, reusableRun }) {
  const workbookRecordKeys = await listStoreMetricRecordKeys({
    workbookPath,
    platformKey: store?.platformKey,
    storeKey: store?.key
  });
  const workbookRecordKeySet = new Set(workbookRecordKeys);
  const previousRecordKeys = Array.from(new Set(
    (Array.isArray(reusableRun?.recordKeys) ? reusableRun.recordKeys : [])
      .map(normalizeText)
      .filter(Boolean)
  ));
  if (previousRecordKeys.length) {
    return previousRecordKeys.every((recordKey) => workbookRecordKeySet.has(recordKey));
  }
  const previousMetricCount = Math.max(0, Number(reusableRun?.metricCount) || 0);
  return previousMetricCount > 0 && workbookRecordKeys.length >= previousMetricCount;
}

module.exports = {
  resolvePlatformDisplayName,
  listStoreMetricRecordKeys,
  hasReusableStoreMetricData
};
