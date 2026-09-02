const { appendImportRecord } = require("../shared/taskHistoryParts/taskHistoryRecordWriter");
const { readSummarySource } = require("./summaryDataSourceReader");
const { buildSummaryDataRows } = require("./summaryDataRows");
const { writeSummaryData } = require("./summaryDataWriter");
const { createPersonRoleRecord } = require("../shared/personRoles");

function getGlobalPersonMappings(projectConfig) {
  // 这个函数只取得后台唯一维护的客服姓名映射。
  return projectConfig?.globalDefaults?.reportProfiles?.performance?.personMappings || [];
}

function findSourceFileForReportContext(reportContext, sourceGroups, sourceFiles) {
  // 这个函数只定位当前报表所对应的真实下载文件。
  const sourceGroup = sourceGroups.find((group) => group.contexts.includes(reportContext));
  if (!sourceGroup?.filePath) throw new Error(`未找到报表「${reportContext.reportKey}」的源文件。`);
  const sourceFile = sourceFiles.find((item) => item.filePath === sourceGroup.filePath);
  return { sourceGroup, sourceFile: sourceFile || { filePath: sourceGroup.filePath } };
}

async function readStoreReportContexts(input) {
  // 这个函数只按报表配置读取一家店的所有源数据。
  const personMappings = getGlobalPersonMappings(input.projectConfig);
  const reportReadResults = [];
  for (const reportContext of input.reportContexts) {
    const { sourceGroup, sourceFile } = findSourceFileForReportContext(reportContext, input.sourceGroups, input.sourceFiles);
    const reportProfile = reportContext.resolvedConfig.activeStore;
    input.onProgress?.("读取源表", `报表=${reportProfile.activeReportDisplayName || reportContext.reportKey}，文件=${sourceGroup.filePath}`);
    const readResult = await (input.readSummarySource || readSummarySource)({
      sourceFilePath: sourceGroup.filePath,
      reportProfile,
      personMappings
    });
    reportReadResults.push({
      reportKey: reportContext.reportKey,
      sourceFilePath: sourceFile.filePath,
      ...readResult
    });
  }
  return reportReadResults;
}

function recordSuccessfulStoreImports(input, workbookPath) {
  // 这个函数只在整店数据成功替换后登记各报表成功记录。
  input.reportContexts.forEach((reportContext) => {
    const { sourceGroup } = findSourceFileForReportContext(reportContext, input.sourceGroups, input.sourceFiles);
    appendImportRecord({
      platformKey: input.task.platformKey,
      reportKey: reportContext.reportKey,
      storeKey: input.task.storeKey,
      storeDisplayName: input.task.storeDisplayName,
      sourceFilePath: sourceGroup.filePath,
      workbookPath,
      exportStartText: input.dateRange.startText,
      exportEndText: input.dateRange.endText,
      createdAt: new Date().toISOString()
    });
  });
}

async function importStoreDataToSummary(input) {
  // 这个函数只完成“全部读成功后，替换本店本期旧行”的一次写入。
  const reportReadResults = await readStoreReportContexts(input);
  const detailRows = buildSummaryDataRows({
    task: input.task,
    dateRange: input.dateRange,
    sourceFiles: input.sourceFiles,
    reportReadResults
  });
  const workbookPath = String(input.reportContexts[0]?.resolvedConfig?.workbook?.path || "").trim();
  if (!workbookPath) throw new Error("没有配置新的客服数据总表。");
  input.onProgress?.("替换数据明细", `本店本期 ${detailRows.length} 位客服，写入唯一数据源。`);
  const personRoles = createPersonRoleRecord(getGlobalPersonMappings(input.projectConfig));
  const writeResult = await (input.writeSummaryData || writeSummaryData)({ workbookPath, rows: detailRows, personRoles });
  recordSuccessfulStoreImports(input, workbookPath);
  return {
    workbookPath,
    detailRows,
    writeResult,
    reportReadResults
  };
}

module.exports = {
  importStoreDataToSummary,
  getGlobalPersonMappings,
  findSourceFileForReportContext
};
