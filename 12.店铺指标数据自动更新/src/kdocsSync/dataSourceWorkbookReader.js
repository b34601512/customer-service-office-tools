const fs = require("fs");
const path = require("path");
const {
  loadXlsxArchive,
  resolveWorksheetArchivePath,
  readArchiveXml,
  loadSharedStringStore,
  readWorksheetRows,
  columnIndexToLetters
} = require("../summaryData/xlsxWorkbookEngine");
const {
  dataSourceSheetName,
  dataSourceHeaderRowNumber,
  dataSourceFirstDataRowNumber,
  requiredDataSourceHeaders
} = require("../summaryData/storeMetricDataSourceSchema");

function readFixedWidthRow(worksheetCells, columnCount) {
  return Array.from({ length: columnCount }, (_, columnOffset) => {
    const rawValue = worksheetCells?.get(columnOffset + 1)?.value;
    return rawValue == null ? "" : rawValue;
  });
}

function requireExpectedDataSourceHeaders(headerValues) {
  for (let columnOffset = 0; columnOffset < requiredDataSourceHeaders.length; columnOffset += 1) {
    const actualHeader = String(headerValues[columnOffset] ?? "").trim();
    if (actualHeader !== requiredDataSourceHeaders[columnOffset]) {
      const excelColumnName = columnIndexToLetters(columnOffset + 1);
      throw new Error(
        `本地数据源第${excelColumnName}列应为「${requiredDataSourceHeaders[columnOffset]}」，实际为「${actualHeader || "空"}」。 `
      );
    }
  }
}

function resolveLastDataRowNumber(worksheetRows) {
  const recordKeyColumnNumber = requiredDataSourceHeaders.indexOf("记录键") + 1;
  const dataRowNumbers = [...worksheetRows.entries()]
    .filter(([rowNumber, cells]) => (
      rowNumber >= dataSourceFirstDataRowNumber &&
      String(cells.get(recordKeyColumnNumber)?.value ?? "").trim()
    ))
    .map(([rowNumber]) => rowNumber);
  return dataRowNumbers.length ? Math.max(...dataRowNumbers) : 0;
}

function buildDataSourceMatrix(worksheetRows) {
  const headerValues = readFixedWidthRow(
    worksheetRows.get(dataSourceHeaderRowNumber),
    requiredDataSourceHeaders.length
  );
  requireExpectedDataSourceHeaders(headerValues);
  const lastDataRowNumber = resolveLastDataRowNumber(worksheetRows);
  if (!lastDataRowNumber) {
    throw new Error("本地统一数据源没有数据，为避免误清空在线文档，本次未同步。 ");
  }

  const recordKeyColumnOffset = requiredDataSourceHeaders.indexOf("记录键");
  const dataSourceRows = [headerValues];
  for (
    let rowNumber = dataSourceFirstDataRowNumber;
    rowNumber <= lastDataRowNumber;
    rowNumber += 1
  ) {
    const rowValues = readFixedWidthRow(
      worksheetRows.get(rowNumber),
      requiredDataSourceHeaders.length
    );
    if (!String(rowValues[recordKeyColumnOffset] ?? "").trim()) {
      throw new Error(`本地数据源第${rowNumber}行缺少记录键，请先检查汇总表。 `);
    }
    dataSourceRows.push(rowValues);
  }
  return {
    dataSourceRows,
    dataRowCount: dataSourceRows.length - 1,
    columnCount: requiredDataSourceHeaders.length,
    firstRecordKey: String(dataSourceRows[1][recordKeyColumnOffset] ?? ""),
    lastRecordKey: String(dataSourceRows[dataSourceRows.length - 1][recordKeyColumnOffset] ?? "")
  };
}

async function readDataSourceWorkbook(workbookPath) {
  const normalizedWorkbookPath = String(workbookPath || "").trim();
  if (
    path.extname(normalizedWorkbookPath).toLowerCase() !== ".xlsx" ||
    !fs.existsSync(normalizedWorkbookPath) ||
    !fs.statSync(normalizedWorkbookPath).isFile()
  ) {
    throw new Error(`本地汇总表不存在或不是 .xlsx 文件：${normalizedWorkbookPath || "未设置"}`);
  }
  const workbookArchive = await loadXlsxArchive(normalizedWorkbookPath);
  const sharedStringStore = await loadSharedStringStore(workbookArchive);
  const { worksheetPath } = await resolveWorksheetArchivePath(
    workbookArchive,
    "named_sheet",
    dataSourceSheetName
  );
  const worksheetDocument = await readArchiveXml(workbookArchive, worksheetPath);
  const worksheetRows = readWorksheetRows(worksheetDocument, sharedStringStore.values);
  return buildDataSourceMatrix(worksheetRows);
}

module.exports = {
  readFixedWidthRow,
  requireExpectedDataSourceHeaders,
  resolveLastDataRowNumber,
  buildDataSourceMatrix,
  readDataSourceWorkbook
};
