const path = require("path");
const {
  spreadsheetNamespace,
  listElements,
  findFirstElement,
  readArchiveXml,
  writeArchiveXml,
  loadXlsxArchive,
  resolveArchiveTarget,
  resolveWorksheetArchivePath,
  loadSharedStringStore,
  readWorksheetRows,
  columnIndexToLetters,
  saveXlsxArchiveAtomically
} = require("./xlsxWorkbookEngine");
const {
  dataSourceSheetName,
  requiredDataSourceHeaders
} = require("./storeMetricDataSourceSchema");
const {
  normalizeText,
  resolveHeaderColumns,
  readCell
} = require("./storeMetricHeaderColumns");

const requiredHeaders = requiredDataSourceHeaders;

function dateTextToExcelSerial(dateText) {
  const matchedDate = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) throw new Error(`无法识别日期：${dateText}`);
  return (
    Date.UTC(Number(matchedDate[1]), Number(matchedDate[2]) - 1, Number(matchedDate[3])) -
    Date.UTC(1899, 11, 30)
  ) / 86400000;
}

function isoTextToDateText(dateText) {
  const parsedDate = new Date(String(dateText || ""));
  if (!Number.isFinite(parsedDate.getTime())) throw new Error(`无法识别采集时间：${dateText}`);
  return `${parsedDate.getUTCFullYear()}-${String(parsedDate.getUTCMonth() + 1).padStart(2, "0")}-` +
    `${String(parsedDate.getUTCDate()).padStart(2, "0")}`;
}

function readExistingRecords(worksheetRows, headerColumns) {
  const records = [];
  for (const [rowNumber, cells] of worksheetRows.entries()) {
    if (rowNumber <= 1 || !normalizeText(readCell(cells, headerColumns, "记录键"))) continue;
    records.push({
      collectionDate: readCell(cells, headerColumns, "采集日期"),
      platform: normalizeText(readCell(cells, headerColumns, "平台")),
      storeKey: normalizeText(readCell(cells, headerColumns, "店铺编号")),
      storeName: normalizeText(readCell(cells, headerColumns, "店铺名称")),
      metricName: normalizeText(readCell(cells, headerColumns, "指标名称")),
      metricValue: Number(readCell(cells, headerColumns, "指标数值")),
      unit: normalizeText(readCell(cells, headerColumns, "单位")),
      originalStatisticsWindow: normalizeText(readCell(cells, headerColumns, "原始统计窗口")),
      sourcePage: normalizeText(readCell(cells, headerColumns, "来源页面")),
      sourceUrl: normalizeText(readCell(cells, headerColumns, "来源地址")),
      sourceOriginalMetricName: normalizeText(readCell(cells, headerColumns, "平台原始指标名")),
      recordKey: normalizeText(readCell(cells, headerColumns, "记录键"))
    });
  }
  return records;
}

function normalizeIncomingRecord(record) {
  return {
    collectionDate: dateTextToExcelSerial(isoTextToDateText(record.collectedAt)),
    platform: normalizeText(record.platform),
    storeKey: normalizeText(record.storeKey),
    storeName: normalizeText(record.storeName),
    metricName: normalizeText(record.metricName),
    metricValue: Number(record.metricValue),
    unit: normalizeText(record.unit),
    originalStatisticsWindow: normalizeText(record.originalStatisticsWindow),
    sourcePage: normalizeText(record.sourcePage),
    sourceUrl: normalizeText(record.sourceUrl),
    sourceOriginalMetricName: normalizeText(record.sourceOriginalMetricName),
    recordKey: normalizeText(record.recordKey)
  };
}

function appendElementText(document, parent, elementName, text) {
  const element = document.createElementNS(spreadsheetNamespace, elementName);
  element.appendChild(document.createTextNode(String(text)));
  parent.appendChild(element);
}

function appendNumericCell(document, rowElement, reference, styleIndex, value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) throw new Error(`写入统一数据源失败：${reference} 不是数值。`);
  const cellElement = document.createElementNS(spreadsheetNamespace, "c");
  cellElement.setAttribute("r", reference);
  cellElement.setAttribute("s", String(styleIndex));
  appendElementText(document, cellElement, "v", numericValue);
  rowElement.appendChild(cellElement);
}

function appendTextCell(document, rowElement, reference, styleIndex, value, sharedStrings) {
  const text = String(value ?? "");
  const cellElement = document.createElementNS(spreadsheetNamespace, "c");
  cellElement.setAttribute("r", reference);
  cellElement.setAttribute("s", String(styleIndex));
  cellElement.setAttribute("t", "s");
  appendElementText(document, cellElement, "v", sharedStrings.getIndex(text));
  rowElement.appendChild(cellElement);
}

function buildDataRow(document, record, rowNumber, styleIndexes, sharedStrings) {
  const rowElement = document.createElementNS(spreadsheetNamespace, "row");
  rowElement.setAttribute("r", String(rowNumber));
  rowElement.setAttribute("spans", `1:${requiredHeaders.length}`);
  const values = [
    record.collectionDate, record.platform, record.storeKey, record.storeName,
    record.metricName, record.metricValue, record.unit, record.originalStatisticsWindow,
    record.sourcePage, record.sourceUrl, record.sourceOriginalMetricName, record.recordKey
  ];
  const numericColumns = new Set([1, 6]);
  values.forEach((value, columnOffset) => {
    const columnIndex = columnOffset + 1;
    const columnLetters = columnIndexToLetters(columnIndex);
    const styleIndex = styleIndexes[columnOffset] ?? 0;
    if (numericColumns.has(columnIndex)) {
      appendNumericCell(document, rowElement, `${columnLetters}${rowNumber}`, styleIndex, value);
    } else {
      appendTextCell(document, rowElement, `${columnLetters}${rowNumber}`, styleIndex, value, sharedStrings);
    }
  });
  return rowElement;
}

function replaceDataRows(worksheetDocument, records, styleIndexes, sharedStrings) {
  const sheetData = findFirstElement(worksheetDocument, "sheetData");
  if (!sheetData) throw new Error("统一数据源缺少工作表数据区。");
  for (const rowElement of listElements(sheetData, "row")) {
    if (Number(rowElement.getAttribute("r")) >= 2) sheetData.removeChild(rowElement);
  }
  records.forEach((record, recordIndex) => {
    sheetData.appendChild(buildDataRow(worksheetDocument, record, recordIndex + 2, styleIndexes, sharedStrings));
  });
  const lastColumnLetters = columnIndexToLetters(requiredHeaders.length);
  const lastRowNumber = Math.max(2, records.length + 1);
  const dimension = findFirstElement(worksheetDocument, "dimension");
  if (dimension) dimension.setAttribute("ref", `A1:${lastColumnLetters}${lastRowNumber}`);
  return { lastRowNumber, lastColumnLetters };
}

async function resolveDataTablePath(archive, worksheetPath) {
  const worksheetDirectory = path.posix.dirname(worksheetPath);
  const worksheetFileName = path.posix.basename(worksheetPath);
  const relationshipsPath = path.posix.join(worksheetDirectory, "_rels", `${worksheetFileName}.rels`);
  const relationshipsDocument = await readArchiveXml(archive, relationshipsPath);
  const tableRelationship = listElements(relationshipsDocument, "Relationship")
    .find((relationship) => /\/table$/.test(relationship.getAttribute("Type") || ""));
  if (!tableRelationship) throw new Error("统一数据源缺少可筛选的数据表。");
  return resolveArchiveTarget(worksheetDirectory, tableRelationship.getAttribute("Target"));
}

function requestFormulaRecalculation(workbookDocument) {
  const calculationProperties = findFirstElement(workbookDocument, "calcPr");
  if (!calculationProperties) return;
  calculationProperties.setAttribute("calcMode", "auto");
  calculationProperties.setAttribute("fullCalcOnLoad", "1");
  calculationProperties.setAttribute("forceFullCalc", "1");
}

function filterRetiredSourceRecords(records, retiredSourcePages = []) {
  const retiredSourcePageSet = new Set(
    (Array.isArray(retiredSourcePages) ? retiredSourcePages : []).map(normalizeText).filter(Boolean)
  );
  if (!retiredSourcePageSet.size) return [...records];
  return records.filter((record) => !retiredSourcePageSet.has(normalizeText(record.sourcePage)));
}

async function writeStoreMetricRecords({ workbookPath, records, retiredSourcePages = [] }) {
  const incomingRecords = (Array.isArray(records) ? records : []).map(normalizeIncomingRecord);
  if (!incomingRecords.length) throw new Error("本次没有可写入的店铺指标。");
  const archive = await loadXlsxArchive(workbookPath);
  const sharedStrings = await loadSharedStringStore(archive);
  const { worksheetPath } = await resolveWorksheetArchivePath(archive, "named_sheet", dataSourceSheetName);
  const worksheetDocument = await readArchiveXml(archive, worksheetPath);
  const worksheetRows = readWorksheetRows(worksheetDocument, sharedStrings.values);
  const headerColumns = resolveHeaderColumns(worksheetRows.get(1) || new Map(), requiredHeaders);
  const existingRecords = readExistingRecords(worksheetRows, headerColumns);
  const activeExistingRecords = filterRetiredSourceRecords(existingRecords, retiredSourcePages);
  const incomingStoreKeys = new Set(incomingRecords.map((record) => `${record.platform}|${record.storeKey}`));
  const retainedRecords = activeExistingRecords.filter((record) =>
    !incomingStoreKeys.has(`${record.platform}|${record.storeKey}`)
  );
  const styleSourceRow = worksheetRows.get(2) || new Map();
  const styleIndexes = requiredHeaders.map((_, columnOffset) => styleSourceRow.get(columnOffset + 1)?.styleIndex ?? 0);
  const recordsToWrite = [...retainedRecords, ...incomingRecords];
  const { lastRowNumber, lastColumnLetters } = replaceDataRows(worksheetDocument, recordsToWrite, styleIndexes, sharedStrings);
  writeArchiveXml(archive, worksheetPath, worksheetDocument);

  const tablePath = await resolveDataTablePath(archive, worksheetPath);
  const tableDocument = await readArchiveXml(archive, tablePath);
  tableDocument.documentElement.setAttribute("ref", `A1:${lastColumnLetters}${lastRowNumber}`);
  const autoFilter = findFirstElement(tableDocument, "autoFilter");
  if (autoFilter) autoFilter.setAttribute("ref", `A1:${lastColumnLetters}${lastRowNumber}`);
  writeArchiveXml(archive, tablePath, tableDocument);

  const workbookDocument = await readArchiveXml(archive, "xl/workbook.xml");
  requestFormulaRecalculation(workbookDocument);
  writeArchiveXml(archive, "xl/workbook.xml", workbookDocument);
  const sharedStringReferenceCount = listElements(worksheetDocument, "c")
    .filter((cell) => cell.getAttribute("t") === "s").length;
  sharedStrings.save(sharedStringReferenceCount);
  await saveXlsxArchiveAtomically(archive, workbookPath);
  return {
    replacedCount: activeExistingRecords.length - retainedRecords.length,
    removedCount: existingRecords.length - activeExistingRecords.length,
    writtenCount: incomingRecords.length,
    totalCount: recordsToWrite.length
  };
}

module.exports = {
  requiredHeaders,
  dateTextToExcelSerial,
  filterRetiredSourceRecords,
  writeStoreMetricRecords
};
