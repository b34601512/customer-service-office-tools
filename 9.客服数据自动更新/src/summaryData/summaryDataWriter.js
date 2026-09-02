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
  saveXlsxArchiveAtomically
} = require("./xlsxWorkbookEngine");
const {
  detailSheetName,
  legacyRequiredHeaders,
  requiredHeaders,
  thirtySecondWithinCountHeader,
  thirtySecondResponseRateHeader
} = require("./summaryDataDetailSchema");

function normalizeText(value) {
  // 这个函数只去掉文本两端空白。
  return String(value ?? "").trim();
}

function dateTextToExcelSerial(dateText) {
  // 这个函数只把 yyyy-MM-dd 转换成 Excel 日期序号。
  const matchedDate = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matchedDate) {
    throw new Error(`无法识别统计日期：${dateText}`);
  }
  const utcMilliseconds = Date.UTC(
    Number(matchedDate[1]),
    Number(matchedDate[2]) - 1,
    Number(matchedDate[3])
  );
  return (utcMilliseconds - Date.UTC(1899, 11, 30)) / 86400000;
}

function isoTextToExcelSerial(dateText) {
  // 这个函数只把 ISO 时间转换成 Excel 日期时间序号。
  const milliseconds = new Date(String(dateText || "")).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`无法识别导入时间：${dateText}`);
  }
  return (milliseconds - Date.UTC(1899, 11, 30)) / 86400000;
}

function resolveHeaderColumns(headerCells) {
  // 这个函数只确认汇总表头完整，并返回字段对应列号。
  const headerColumns = new Map();
  for (const [columnIndex, cell] of headerCells.entries()) {
    const header = normalizeText(cell.value);
    if (header) {
      headerColumns.set(header, columnIndex);
    }
  }
  for (const requiredHeader of requiredHeaders) {
    if (!headerColumns.has(requiredHeader)) {
      throw new Error(`数据明细缺少列「${requiredHeader}」。请使用新的客服数据总表模板。`);
    }
  }
  return headerColumns;
}

function readNumber(cells, headerColumns, header) {
  // 这个函数只读取一个可为空的数字字段。
  const value = cells.get(headerColumns.get(header))?.value;
  if (value == null || normalizeText(value) === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`数据明细存在不能识别的数字：${value}`);
  }
  return number;
}

function readText(cells, headerColumns, header) {
  // 这个函数只读取一个文本字段。
  return normalizeText(cells.get(headerColumns.get(header))?.value);
}

function readExistingRows(worksheetRows, headerColumns) {
  // 这个函数只读取汇总表既有业务数据，派生百分比会在重写时重新生成。
  const rows = [];
  for (const [rowNumber, cells] of worksheetRows.entries()) {
    if (rowNumber <= 4 || !readText(cells, headerColumns, "客服姓名")) {
      continue;
    }
    rows.push({
      periodStart: readNumber(cells, headerColumns, "统计开始日"),
      periodEnd: readNumber(cells, headerColumns, "统计结束日"),
      periodGranularity: readText(cells, headerColumns, "统计粒度"),
      platform: readText(cells, headerColumns, "平台"),
      storeKey: readText(cells, headerColumns, "店铺编号"),
      storeName: readText(cells, headerColumns, "店铺名称"),
      personName: readText(cells, headerColumns, "客服姓名"),
      salesAmount: readNumber(cells, headerColumns, "销售额"),
      inquiryCount: readNumber(cells, headerColumns, "询单人数"),
      orderCount: readNumber(cells, headerColumns, "下单人数"),
      responseWeight: readNumber(cells, headerColumns, "接待会话量"),
      responseTotalSeconds: readNumber(cells, headerColumns, "响应总秒数"),
      threeMinuteWithinCount: readNumber(cells, headerColumns, "3分钟内响应会话量"),
      thirtySecondWithinCount: readNumber(cells, headerColumns, thirtySecondWithinCountHeader),
      satisfiedCount: readNumber(cells, headerColumns, "满意评价量"),
      evaluationCount: readNumber(cells, headerColumns, "评价量"),
      sourceFiles: readText(cells, headerColumns, "来源文件"),
      importedAt: readNumber(cells, headerColumns, "导入时间")
    });
  }
  return rows;
}

function normalizeIncomingRows(rows) {
  // 这个函数只把本次写入行转换成工作簿内部的确定类型。
  return rows.map((row) => ({
    periodStart: dateTextToExcelSerial(row.periodStart),
    periodEnd: dateTextToExcelSerial(row.periodEnd),
    periodGranularity: normalizeText(row.periodGranularity),
    platform: normalizeText(row.platform),
    storeKey: normalizeText(row.storeKey),
    storeName: normalizeText(row.storeName),
    personName: normalizeText(row.personName),
    salesAmount: row.salesAmount,
    inquiryCount: row.inquiryCount,
    orderCount: row.orderCount,
    responseWeight: row.responseWeight,
    responseTotalSeconds: row.responseTotalSeconds,
    threeMinuteWithinCount: row.threeMinuteWithinCount,
    thirtySecondWithinCount: row.thirtySecondWithinCount,
    satisfiedCount: row.satisfiedCount,
    evaluationCount: row.evaluationCount,
    sourceFiles: normalizeText(row.sourceFiles),
    importedAt: isoTextToExcelSerial(row.importedAt)
  }));
}

function resolveReplacementScope(incomingRows) {
  // 这个函数只确认一次写入属于同一店铺、同一统计期间。
  if (!incomingRows.length) {
    return null;
  }
  const scope = {
    platform: incomingRows[0].platform,
    storeKey: incomingRows[0].storeKey,
    periodStart: incomingRows[0].periodStart,
    periodEnd: incomingRows[0].periodEnd
  };
  for (const row of incomingRows) {
    if (
      row.platform !== scope.platform ||
      row.storeKey !== scope.storeKey ||
      row.periodStart !== scope.periodStart ||
      row.periodEnd !== scope.periodEnd
    ) {
      throw new Error("一次写入只能包含同一店铺、同一统计期间的数据。");
    }
  }
  return scope;
}

function matchesReplacementScope(row, scope) {
  // 这个函数只判断一行是否属于本次要替换的店铺和统计期间。
  return Boolean(scope) &&
    row.platform === scope.platform &&
    row.storeKey === scope.storeKey &&
    row.periodStart === scope.periodStart &&
    row.periodEnd === scope.periodEnd;
}

function buildReplacedSummaryRows(existingRows, incomingRows) {
  // 这个函数只移除同店同期间旧行，再把本次新行放回原有数据集，避免重复追加。
  const safeExistingRows = Array.isArray(existingRows) ? existingRows : [];
  const safeIncomingRows = Array.isArray(incomingRows) ? incomingRows : [];
  const replacementScope = resolveReplacementScope(safeIncomingRows);
  const retainedRows = safeExistingRows.filter((row) => !matchesReplacementScope(row, replacementScope));
  return {
    rowsToWrite: [...retainedRows, ...safeIncomingRows],
    removedCount: safeExistingRows.length - retainedRows.length
  };
}

function resolvePersonRole(personRoles, personName) {
  // 这个函数只按当前客服配置写入售前或售后岗位。
  const personRole = normalizeText(personRoles?.[normalizeText(personName)]);
  return personRole === "售前" || personRole === "售后" ? personRole : "";
}

function appendElementWithText(document, parent, elementName, text) {
  // 这个函数只追加一个带文本的工作表 XML 元素。
  const element = document.createElementNS(spreadsheetNamespace, elementName);
  element.appendChild(document.createTextNode(String(text)));
  parent.appendChild(element);
  return element;
}

function appendNumericCell(document, rowElement, reference, styleIndex, value) {
  // 这个函数只写入一个带既有样式的数字单元格。
  const cell = document.createElementNS(spreadsheetNamespace, "c");
  cell.setAttribute("r", reference);
  cell.setAttribute("s", String(styleIndex));
  if (value != null && normalizeText(value) !== "") {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`写入数据明细失败：${reference} 不是有效数字。`);
    }
    appendElementWithText(document, cell, "v", number);
  }
  rowElement.appendChild(cell);
}

function appendSharedStringCell(document, rowElement, reference, styleIndex, value, sharedStrings) {
  // 这个函数只写入一个共享字符串单元格。
  const text = String(value ?? "");
  if (!text) {
    return;
  }
  const cell = document.createElementNS(spreadsheetNamespace, "c");
  cell.setAttribute("r", reference);
  cell.setAttribute("s", String(styleIndex));
  cell.setAttribute("t", "s");
  appendElementWithText(document, cell, "v", sharedStrings.getIndex(text));
  rowElement.appendChild(cell);
}

function updateLegacyTitleMergeWidths(worksheetDocument) {
  // 这个函数只把旧模板跨 A-V 的标题合并范围扩展到新增的 X 列。
  const replacementByReference = new Map([
    ["A1:V1", "A1:X1"],
    ["A2:V2", "A2:X2"]
  ]);
  listElements(worksheetDocument, "mergeCell").forEach((mergeCell) => {
    const currentReference = mergeCell.getAttribute("ref") || "";
    if (replacementByReference.has(currentReference)) {
      mergeCell.setAttribute("ref", replacementByReference.get(currentReference));
    }
  });
}

function appendThirtySecondMetricColumnWidths(worksheetDocument) {
  // 这个函数只给新增的 W-X 两列补可读宽度，既有列宽原样保留。
  const columnsElement = findFirstElement(worksheetDocument, "cols");
  if (!columnsElement) {
    return;
  }
  const hasMetricColumnWidth = listElements(columnsElement, "col").some((columnElement) => {
    const minimumColumnIndex = Number(columnElement.getAttribute("min"));
    const maximumColumnIndex = Number(columnElement.getAttribute("max"));
    return minimumColumnIndex <= 23 && maximumColumnIndex >= 24;
  });
  if (hasMetricColumnWidth) {
    return;
  }
  const columnElement = worksheetDocument.createElementNS(spreadsheetNamespace, "col");
  columnElement.setAttribute("min", "23");
  columnElement.setAttribute("max", "24");
  columnElement.setAttribute("width", "18");
  columnElement.setAttribute("customWidth", "1");
  columnsElement.appendChild(columnElement);
}

function ensureThirtySecondMetricWorksheetColumns(
  worksheetDocument,
  worksheetRows,
  sharedStrings
) {
  // 这个函数只把旧版 A-V 数据明细安全扩展为带 30 秒指标的 A-X 结构。
  const headerCells = worksheetRows.get(4) || new Map();
  const existingHeaderNames = new Set(
    Array.from(headerCells.values()).map((cell) => normalizeText(cell.value)).filter(Boolean)
  );
  const hasWithinCountHeader = existingHeaderNames.has(thirtySecondWithinCountHeader);
  const hasResponseRateHeader = existingHeaderNames.has(thirtySecondResponseRateHeader);
  if (hasWithinCountHeader && hasResponseRateHeader) {
    return false;
  }
  if (hasWithinCountHeader || hasResponseRateHeader) {
    throw new Error("数据明细的30秒应答率列不完整。请恢复成完整模板后重试。");
  }
  for (const legacyHeader of legacyRequiredHeaders) {
    if (!existingHeaderNames.has(legacyHeader)) {
      throw new Error(`数据明细缺少列「${legacyHeader}」。请使用新的客服数据总表模板。`);
    }
  }
  if ([23, 24].some((columnIndex) => normalizeText(headerCells.get(columnIndex)?.value))) {
    throw new Error("数据明细 W-X 列已有其他内容，无法自动加入30秒应答率。请先人工确认表结构。");
  }

  const headerRowElement = listElements(worksheetDocument, "row")
    .find((rowElement) => Number(rowElement.getAttribute("r")) === 4);
  if (!headerRowElement) {
    throw new Error("数据明细缺少第4行表头。请使用新的客服数据总表模板。");
  }
  const headerStyleIndex = headerCells.get(22)?.styleIndex ?? 5;
  appendSharedStringCell(
    worksheetDocument,
    headerRowElement,
    "W4",
    headerStyleIndex,
    thirtySecondWithinCountHeader,
    sharedStrings
  );
  appendSharedStringCell(
    worksheetDocument,
    headerRowElement,
    "X4",
    headerStyleIndex,
    thirtySecondResponseRateHeader,
    sharedStrings
  );
  headerRowElement.setAttribute("spans", "1:24");
  updateLegacyTitleMergeWidths(worksheetDocument);
  appendThirtySecondMetricColumnWidths(worksheetDocument);
  return true;
}

function ensureThirtySecondMetricTableColumns(tableDocument) {
  // 这个函数只把新增指标登记到 Excel 数据表定义中。
  const tableColumnsElement = findFirstElement(tableDocument, "tableColumns");
  if (!tableColumnsElement) {
    throw new Error("数据明细缺少数据表列定义。请使用新的客服数据总表模板。");
  }
  const tableColumnElements = listElements(tableColumnsElement, "tableColumn");
  const existingColumnNames = new Set(
    tableColumnElements.map((columnElement) => normalizeText(columnElement.getAttribute("name"))).filter(Boolean)
  );
  let nextColumnId = Math.max(
    0,
    ...tableColumnElements.map((columnElement) => Number(columnElement.getAttribute("id")) || 0)
  ) + 1;
  [thirtySecondWithinCountHeader, thirtySecondResponseRateHeader].forEach((columnName) => {
    if (existingColumnNames.has(columnName)) {
      return;
    }
    const tableColumnElement = tableDocument.createElementNS(spreadsheetNamespace, "tableColumn");
    tableColumnElement.setAttribute("id", String(nextColumnId));
    tableColumnElement.setAttribute("name", columnName);
    tableColumnsElement.appendChild(tableColumnElement);
    nextColumnId += 1;
  });
  tableColumnsElement.setAttribute(
    "count",
    String(listElements(tableColumnsElement, "tableColumn").length)
  );
}

function calculateFormulaResult(numerator, denominator) {
  // 这个函数只在分子和分母都有数据时计算比值，任一缺失或分母为零都保持空白。
  if (
    numerator == null ||
    normalizeText(numerator) === "" ||
    denominator == null ||
    normalizeText(denominator) === ""
  ) {
    return null;
  }
  const denominatorNumber = Number(denominator);
  if (!Number.isFinite(denominatorNumber) || denominatorNumber === 0) {
    return null;
  }
  const numeratorNumber = Number(numerator);
  return Number.isFinite(numeratorNumber) ? numeratorNumber / denominatorNumber : null;
}

function appendFormulaCell(document, rowElement, reference, styleIndex, formula, result) {
  // 这个函数只写入公式和可立即显示的计算缓存。
  const cell = document.createElementNS(spreadsheetNamespace, "c");
  cell.setAttribute("r", reference);
  cell.setAttribute("s", String(styleIndex));
  appendElementWithText(document, cell, "f", formula);
  if (result != null && Number.isFinite(result)) {
    appendElementWithText(document, cell, "v", result);
  }
  rowElement.appendChild(cell);
}

function buildDetailRowElement(document, row, rowNumber, personRoles, sharedStrings) {
  // 这个函数只把一位客服的一行数据转换成 A-X 单元格。
  const rowElement = document.createElementNS(spreadsheetNamespace, "row");
  rowElement.setAttribute("r", String(rowNumber));
  rowElement.setAttribute("spans", "1:24");

  appendNumericCell(document, rowElement, `A${rowNumber}`, 6, row.periodStart);
  appendNumericCell(document, rowElement, `B${rowNumber}`, 7, row.periodEnd);
  appendSharedStringCell(document, rowElement, `C${rowNumber}`, 8, row.periodGranularity, sharedStrings);
  appendSharedStringCell(document, rowElement, `D${rowNumber}`, 8, row.platform, sharedStrings);
  appendSharedStringCell(document, rowElement, `E${rowNumber}`, 8, row.storeKey, sharedStrings);
  appendSharedStringCell(document, rowElement, `F${rowNumber}`, 8, row.storeName, sharedStrings);
  appendSharedStringCell(document, rowElement, `G${rowNumber}`, 8, row.personName, sharedStrings);
  appendSharedStringCell(
    document,
    rowElement,
    `H${rowNumber}`,
    8,
    resolvePersonRole(personRoles, row.personName),
    sharedStrings
  );
  appendNumericCell(document, rowElement, `I${rowNumber}`, 9, row.salesAmount);
  appendNumericCell(document, rowElement, `J${rowNumber}`, 10, row.inquiryCount);
  appendNumericCell(document, rowElement, `K${rowNumber}`, 10, row.orderCount);
  appendNumericCell(document, rowElement, `L${rowNumber}`, 10, row.responseWeight);
  appendNumericCell(document, rowElement, `M${rowNumber}`, 10, row.responseTotalSeconds);
  appendNumericCell(document, rowElement, `N${rowNumber}`, 10, row.threeMinuteWithinCount);
  appendNumericCell(document, rowElement, `O${rowNumber}`, 10, row.satisfiedCount);
  appendNumericCell(document, rowElement, `P${rowNumber}`, 10, row.evaluationCount);
  appendSharedStringCell(document, rowElement, `Q${rowNumber}`, 8, row.sourceFiles, sharedStrings);
  appendNumericCell(document, rowElement, `R${rowNumber}`, 11, row.importedAt);
  appendFormulaCell(
    document,
    rowElement,
    `S${rowNumber}`,
    12,
    `IF(OR(K${rowNumber}="",J${rowNumber}="",J${rowNumber}=0),"",K${rowNumber}/J${rowNumber})`,
    calculateFormulaResult(row.orderCount, row.inquiryCount)
  );
  appendFormulaCell(
    document,
    rowElement,
    `T${rowNumber}`,
    13,
    `IF(OR(M${rowNumber}="",L${rowNumber}="",L${rowNumber}=0),"",M${rowNumber}/L${rowNumber})`,
    calculateFormulaResult(row.responseTotalSeconds, row.responseWeight)
  );
  appendFormulaCell(
    document,
    rowElement,
    `U${rowNumber}`,
    12,
    `IF(OR(N${rowNumber}="",L${rowNumber}="",L${rowNumber}=0),"",N${rowNumber}/L${rowNumber})`,
    calculateFormulaResult(row.threeMinuteWithinCount, row.responseWeight)
  );
  appendFormulaCell(
    document,
    rowElement,
    `V${rowNumber}`,
    14,
    `IF(OR(O${rowNumber}="",P${rowNumber}="",P${rowNumber}=0),"",O${rowNumber}/P${rowNumber})`,
    calculateFormulaResult(row.satisfiedCount, row.evaluationCount)
  );
  appendNumericCell(document, rowElement, `W${rowNumber}`, 10, row.thirtySecondWithinCount);
  appendFormulaCell(
    document,
    rowElement,
    `X${rowNumber}`,
    12,
    `IF(OR(W${rowNumber}="",L${rowNumber}="",L${rowNumber}=0),"",W${rowNumber}/L${rowNumber})`,
    calculateFormulaResult(row.thirtySecondWithinCount, row.responseWeight)
  );
  return rowElement;
}

async function resolveDetailTablePath(archive, worksheetPath) {
  // 这个函数只定位数据明细工作表关联的表格定义 XML。
  const worksheetDirectory = path.posix.dirname(worksheetPath);
  const worksheetFileName = path.posix.basename(worksheetPath);
  const relationshipsPath = path.posix.join(
    worksheetDirectory,
    "_rels",
    `${worksheetFileName}.rels`
  );
  const relationshipsDocument = await readArchiveXml(archive, relationshipsPath);
  const tableRelationship = listElements(relationshipsDocument, "Relationship")
    .find((relationship) => /\/table$/.test(relationship.getAttribute("Type") || ""));
  if (!tableRelationship) {
    throw new Error("数据明细缺少可筛选的数据表。请使用新的客服数据总表模板。");
  }
  return resolveArchiveTarget(worksheetDirectory, tableRelationship.getAttribute("Target"));
}

function replaceWorksheetDataRows(worksheetDocument, rows, personRoles, sharedStrings) {
  // 这个函数只替换第 5 行开始的数据区，标题、说明和表头原样保留。
  const sheetData = findFirstElement(worksheetDocument, "sheetData");
  if (!sheetData) {
    throw new Error("数据明细缺少工作表数据区。请使用新的客服数据总表模板。");
  }
  for (const rowElement of listElements(sheetData, "row")) {
    if (Number(rowElement.getAttribute("r")) >= 5) {
      sheetData.removeChild(rowElement);
    }
  }
  rows.forEach((row, index) => {
    sheetData.appendChild(
      buildDetailRowElement(worksheetDocument, row, index + 5, personRoles, sharedStrings)
    );
  });
  const lastRowNumber = Math.max(4, rows.length + 4);
  const dimension = findFirstElement(worksheetDocument, "dimension");
  if (dimension) {
    dimension.setAttribute("ref", `A1:X${lastRowNumber}`);
  }
  return lastRowNumber;
}

function requestFormulaRecalculation(workbookDocument) {
  // 这个函数只要求下次打开时重新计算公式，不改变任何业务数据。
  const calculationProperties = findFirstElement(workbookDocument, "calcPr");
  if (!calculationProperties) {
    return;
  }
  calculationProperties.setAttribute("calcMode", "auto");
  calculationProperties.setAttribute("fullCalcOnLoad", "1");
  calculationProperties.setAttribute("forceFullCalc", "1");
}

async function writeSummaryData({ workbookPath, rows, personRoles, clear = false }) {
  // 这个函数只直接修改 xlsx 内部数据，全程不启动 WPS/Excel。
  const targetWorkbookPath = String(workbookPath || "");
  const incomingRows = normalizeIncomingRows(Array.isArray(rows) ? rows : []);
  const archive = await loadXlsxArchive(targetWorkbookPath);
  const sharedStrings = await loadSharedStringStore(archive);
  const { worksheetPath } = await resolveWorksheetArchivePath(archive, "named_sheet", detailSheetName);
  const worksheetDocument = await readArchiveXml(archive, worksheetPath);
  let worksheetRows = readWorksheetRows(worksheetDocument, sharedStrings.values);
  if (ensureThirtySecondMetricWorksheetColumns(worksheetDocument, worksheetRows, sharedStrings)) {
    worksheetRows = readWorksheetRows(worksheetDocument, sharedStrings.values);
  }
  const headerColumns = resolveHeaderColumns(worksheetRows.get(4) || new Map());
  const existingRows = readExistingRows(worksheetRows, headerColumns);
  // 清空语义：跳过同店同期间替换，直接移除全部既有数据行，只保留表头/标题/样式。
  const rowsToWrite = clear ? [] : buildReplacedSummaryRows(existingRows, incomingRows).rowsToWrite;
  const removedCount = clear ? existingRows.length : buildReplacedSummaryRows(existingRows, incomingRows).removedCount;

  const lastRowNumber = replaceWorksheetDataRows(
    worksheetDocument,
    rowsToWrite,
    personRoles || {},
    sharedStrings
  );
  writeArchiveXml(archive, worksheetPath, worksheetDocument);

  const tablePath = await resolveDetailTablePath(archive, worksheetPath);
  const tableDocument = await readArchiveXml(archive, tablePath);
  ensureThirtySecondMetricTableColumns(tableDocument);
  tableDocument.documentElement.setAttribute("ref", `A4:X${lastRowNumber}`);
  const autoFilterElement = findFirstElement(tableDocument, "autoFilter");
  if (autoFilterElement) {
    autoFilterElement.setAttribute("ref", `A4:X${lastRowNumber}`);
  }
  writeArchiveXml(archive, tablePath, tableDocument);

  const workbookDocument = await readArchiveXml(archive, "xl/workbook.xml");
  requestFormulaRecalculation(workbookDocument);
  writeArchiveXml(archive, "xl/workbook.xml", workbookDocument);

  const sharedStringReferenceCount = listElements(worksheetDocument, "c")
    .filter((cell) => cell.getAttribute("t") === "s").length;
  sharedStrings.save(sharedStringReferenceCount);
  await saveXlsxArchiveAtomically(archive, targetWorkbookPath);
  return {
    removedCount,
    writtenCount: incomingRows.length,
    totalCount: rowsToWrite.length
  };
}

function refreshSummaryDataPersonRoles({ workbookPath, personRoles }) {
  // 这个函数只按当前客服设置回填已有明细的岗位列。
  return writeSummaryData({ workbookPath, rows: [], personRoles });
}

function clearSummaryData({ workbookPath }) {
  // 这个函数只清空数据明细全部既有数据行，保留表头/标题/样式/表定义列。
  return writeSummaryData({ workbookPath, rows: [], personRoles: {}, clear: true });
}

module.exports = {
  writeSummaryData,
  refreshSummaryDataPersonRoles,
  clearSummaryData,
  dateTextToExcelSerial,
  calculateFormulaResult,
  buildDetailRowElement,
  buildReplacedSummaryRows,
  ensureThirtySecondMetricWorksheetColumns,
  ensureThirtySecondMetricTableColumns
};
