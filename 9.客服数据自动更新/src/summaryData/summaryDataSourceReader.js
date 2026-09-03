const fs = require("fs/promises");
const XLSX = require("xlsx");
const {
  loadXlsxArchive,
  readArchiveXml,
  loadSharedStringStore,
  resolveWorksheetArchivePath,
  readWorksheetRows,
  readCellNumberFormats
} = require("./xlsxWorkbookEngine");

async function isZipWorkbook(sourceFilePath) {
  // 这个函数只按文件头识别真实 xlsx，不相信可能写错的扩展名。
  const fileHandle = await fs.open(sourceFilePath, "r");
  try {
    const signature = Buffer.alloc(2);
    await fileHandle.read(signature, 0, 2, 0);
    return signature[0] === 0x50 && signature[1] === 0x4b;
  } finally {
    await fileHandle.close();
  }
}

function readLegacyWorksheetRows(sourceFilePath, sheetMode, sheetName) {
  // 这个函数只读取扩展名伪装成 xlsx 的老式 xls 源表。
  const workbook = XLSX.readFile(sourceFilePath, { cellText: true, cellDates: false });
  const targetSheetName = sheetMode === "first_sheet"
    ? workbook.SheetNames[0]
    : workbook.SheetNames.find((name) => normalizeText(name) === normalizeText(sheetName));
  if (!targetSheetName) {
    throw new Error(`源文件没有子表「${sheetName}」。现有子表：${workbook.SheetNames.join("、")}`);
  }
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[targetSheetName], {
    header: 1,
    raw: false,
    defval: ""
  });
  return new Map(matrix.map((row, rowIndex) => [
    rowIndex + 1,
    new Map(row.map((value, columnIndex) => [
      columnIndex + 1,
      { value, text: String(value ?? ""), styleIndex: 0, numberFormatCode: "" }
    ]))
  ]));
}

function normalizeText(value) {
  // 这个函数只去掉文本两端空白。
  return String(value ?? "").trim();
}

function normalizeHeaderText(value) {
  // 这个函数只统一源表字段名里不影响含义的空格和括号。
  return normalizeText(value).replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
}

function buildSourceNameMap(personMappings) {
  // 这个函数只把全局姓名配置转换成“后台名 -> 汇总姓名”的唯一映射。
  const sourceNameMap = new Map();
  for (const personMapping of Array.isArray(personMappings) ? personMappings : []) {
    const summaryName = normalizeText(personMapping?.summaryName);
    if (!summaryName) {
      throw new Error("全局姓名映射缺少姓名。");
    }
    for (const sourceNameValue of Array.isArray(personMapping?.sourceNames) ? personMapping.sourceNames : []) {
      const sourceName = normalizeText(sourceNameValue);
      if (!sourceName) {
        continue;
      }
      const existingSummaryName = sourceNameMap.get(sourceName);
      if (existingSummaryName && existingSummaryName !== summaryName) {
        throw new Error(`后台名称「${sourceName}」同时映射到「${existingSummaryName}」和「${summaryName}」。`);
      }
      sourceNameMap.set(sourceName, summaryName);
    }
  }
  if (!sourceNameMap.size) {
    throw new Error("全局姓名映射为空，无法导入客服数据。");
  }
  return sourceNameMap;
}

function resolveSummaryName(sourceName, sourceNameMap) {
  // 这个函数只按全名或最长末尾昵称匹配汇总姓名。
  if (sourceNameMap.has(sourceName)) {
    return sourceNameMap.get(sourceName);
  }
  const matchedSourceName = Array.from(sourceNameMap.keys())
    .filter((candidate) => candidate.length < sourceName.length && sourceName.endsWith(candidate))
    .sort((left, right) => right.length - left.length)[0];
  return matchedSourceName ? sourceNameMap.get(matchedSourceName) : "";
}

function assertMetricMappings(metricMappings) {
  // 这个函数只确认每个指标都有唯一标识和源字段名。
  const seenKeys = new Set();
  for (const metricMapping of metricMappings) {
    const metricKey = normalizeText(metricMapping?.key);
    const sourceFieldLabel = normalizeText(metricMapping?.sourceFieldLabel);
    if (!metricKey || !sourceFieldLabel) {
      throw new Error("指标映射必须同时填写指标标识和源字段名。");
    }
    if (seenKeys.has(metricKey)) {
      throw new Error(`源表配置存在重复指标：${metricKey}`);
    }
    seenKeys.add(metricKey);
  }
}

function resolveHeaderColumns(headerCells, requiredHeaders) {
  // 这个函数只把配置字段名定位到源表第一行的真实列号。
  const headerToColumn = new Map();
  for (const [columnIndex, cell] of headerCells.entries()) {
    const normalizedHeader = normalizeHeaderText(cell.value);
    if (normalizedHeader) {
      headerToColumn.set(normalizedHeader, columnIndex);
    }
  }
  const resolvedColumns = new Map();
  for (const requiredHeader of requiredHeaders) {
    const normalizedHeader = normalizeHeaderText(requiredHeader);
    if (!headerToColumn.has(normalizedHeader)) {
      throw new Error(
        `源文件缺少已配置字段「${requiredHeader}」。当前表头：${Array.from(headerToColumn.keys()).sort().join("、")}`
      );
    }
    resolvedColumns.set(requiredHeader, headerToColumn.get(normalizedHeader));
  }
  return resolvedColumns;
}

function parseDurationText(text) {
  // 这个函数只把带中文单位或时分秒冒号的时长转换成秒。
  const hourMatch = text.match(/(-?\d+(?:\.\d+)?)\s*(?:小时|时)/);
  const minuteMatch = text.match(/(-?\d+(?:\.\d+)?)\s*(?:分钟|分)/);
  const secondMatch = text.match(/(-?\d+(?:\.\d+)?)\s*秒/);
  if (hourMatch || minuteMatch || secondMatch) {
    return Number(hourMatch?.[1] || 0) * 3600 +
      Number(minuteMatch?.[1] || 0) * 60 +
      Number(secondMatch?.[1] || 0);
  }
  if (/^-?\d{1,3}:\d{1,2}(?::\d{1,2}(?:\.\d+)?)?$/.test(text)) {
    const parts = text.split(":").map(Number);
    return parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  }
  return null;
}

function isMissingDurationText(text) {
  // 这个函数只识别“--分--秒”这类明确的无数据时长，不把它误当成数字。
  return /^(?:(?:--+|—+|-)\s*(?:小时|时|分钟|分|秒)\s*){1,3}$/.test(text);
}

function isExcelTimeFormat(numberFormatCode) {
  // 这个函数只识别纯时间或累计时长数字格式，不把日期列当成时长。
  const normalizedFormat = String(numberFormatCode || "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .toLowerCase();
  return /(?:\[h+\]|\[m+\]|\[s+\]|h+|m+|s+):/.test(normalizedFormat) &&
    !/[yd]/.test(normalizedFormat);
}

function convertSourceCellToNumber(cell) {
  // 这个函数只把一个指标单元格转换成数值、百分比小数或秒数。
  if (!cell || cell.value == null || normalizeText(cell.value) === "") {
    return null;
  }
  if (typeof cell.value === "number") {
    if (/%/.test(cell.numberFormatCode)) {
      return cell.value;
    }
    if (isExcelTimeFormat(cell.numberFormatCode)) {
      return cell.value * 86400;
    }
    return cell.value;
  }

  const text = normalizeText(cell.value);
  if (isMissingDurationText(text)) {
    return null;
  }
  if (/^(?:--+|—+|-)+%?$/.test(text)) {
    return null;
  }
  if (/^(?:NaN|null|undefined|#DIV\/0!|#N\/A|#VALUE!|#REF!|#NUM!)$/i.test(text)) {
    // 平台无数据时导出占位符（如京东对 0 接待客服的响应时长直接写 "NaN"），
    // 与 "-" 同义按空值处理，单个格子缺数据不能连累整店失败。
    return null;
  }
  if (/%$/.test(text)) {
    const percentage = Number(text.slice(0, -1).replace(/,/g, ""));
    if (Number.isFinite(percentage)) {
      return percentage / 100;
    }
    throw new Error(`无法读取百分比：${text}`);
  }
  const durationSeconds = parseDurationText(text);
  if (durationSeconds != null) {
    return durationSeconds;
  }
  const number = Number(text.replace(/,/g, ""));
  if (Number.isFinite(number)) {
    return number;
  }
  throw new Error(`无法读取数值：${text}`);
}

function readMatchedSourceRows(worksheetRows, reportProfile, personMappings) {
  // 这个函数只读取命中姓名配置的源表行。
  const metricMappings = Array.isArray(reportProfile?.metricMappings) ? reportProfile.metricMappings : [];
  assertMetricMappings(metricMappings);
  const aliasFieldLabel = normalizeText(reportProfile?.sourceAliasFieldLabel);
  const requiredHeaders = [
    aliasFieldLabel,
    ...metricMappings.map((metricMapping) => normalizeText(metricMapping.sourceFieldLabel))
  ];
  const headerColumns = resolveHeaderColumns(worksheetRows.get(1) || new Map(), requiredHeaders);
  const sourceNameMap = buildSourceNameMap(personMappings);
  const rows = [];

  for (const [rowNumber, cells] of worksheetRows.entries()) {
    if (rowNumber < 2) {
      continue;
    }
    const sourceName = normalizeText(cells.get(headerColumns.get(aliasFieldLabel))?.value);
    if (!sourceName) {
      continue;
    }
    const personName = resolveSummaryName(sourceName, sourceNameMap);
    if (!personName) {
      continue;
    }
    const metrics = {};
    for (const metricMapping of metricMappings) {
      const metricKey = normalizeText(metricMapping.key);
      const sourceFieldLabel = normalizeText(metricMapping.sourceFieldLabel);
      metrics[metricKey] = convertSourceCellToNumber(cells.get(headerColumns.get(sourceFieldLabel)));
    }
    rows.push({ sourceName, personName, metrics });
  }

  if (!rows.length) {
    throw new Error("源文件没有命中任何已配置客服。请确认后台姓名匹配已填写需要统计的客服。");
  }
  return rows;
}

async function readSummarySource({ sourceFilePath, reportProfile, personMappings }) {
  // 这个函数只读取一张真实 xlsx 源表，全程不启动 WPS/Excel。
  const targetSourceFilePath = String(sourceFilePath || "");
  if (!(await isZipWorkbook(targetSourceFilePath))) {
    return {
      rows: readMatchedSourceRows(
        readLegacyWorksheetRows(
          targetSourceFilePath,
          String(reportProfile?.sourceSheetMode || ""),
          String(reportProfile?.sourceSheetName || "")
        ),
        reportProfile,
        personMappings
      )
    };
  }
  const archive = await loadXlsxArchive(targetSourceFilePath);
  const sharedStringStore = await loadSharedStringStore(archive);
  const numberFormats = await readCellNumberFormats(archive);
  const { worksheetPath } = await resolveWorksheetArchivePath(
    archive,
    String(reportProfile?.sourceSheetMode || ""),
    String(reportProfile?.sourceSheetName || "")
  );
  const worksheetDocument = await readArchiveXml(archive, worksheetPath);
  const worksheetRows = readWorksheetRows(
    worksheetDocument,
    sharedStringStore.values,
    numberFormats
  );
  return {
    rows: readMatchedSourceRows(worksheetRows, reportProfile, personMappings)
  };
}

module.exports = {
  readSummarySource,
  normalizeHeaderText,
  convertSourceCellToNumber,
  isMissingDurationText,
  resolveSummaryName
};
