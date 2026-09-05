// 该文件负责"开始全部汇总"前的一轮重置：清空数据明细、重置运行历史、清理今天以前的源文件，只保留今天。
const fs = require("fs");
const path = require("path");
const { log } = require("../../engine/logger");
const { readTaskHistory, writeTaskHistory } = require("../../shared/taskHistoryParts/taskHistoryStore");
const { clearSummaryData } = require("../../summaryData/summaryDataWriter");
const { formatLocalDayText } = require("../summarySourceReuse");
const { movePathToBackup } = require("../../engine/fileSystem");

function isFileTodayOrLater(filePath, now) {
  // 这个函数只按文件实际修改时间判断"是否今天下载"（应保留），否则视为旧文件（应清理）。
  // 不再解析平台文件名：抖音等文件名以导出范围日期开头，解析文件名会被误判为旧文件而误删。
  const todayText = formatLocalDayText(now);
  try {
    const stat = fs.statSync(filePath);
    return formatLocalDayText(stat.mtime) >= todayText;
  } catch {
    // 无法读取文件信息时保守保留，避免误删仍需要的文件。
    return true;
  }
}

function cleanOldSourceFiles(downloadRootDir, now, options = {}) {
  // 只清理下载历史登记过的源表，禁止递归处理使用者的任意 Excel。
  if (!downloadRootDir || !fs.existsSync(downloadRootDir)) {
    return { removedCount: 0 };
  }
  const root = fs.realpathSync(downloadRootDir);
  const history = options.history || readTaskHistory();
  const protectedWorkbook = options.workbookPath && fs.existsSync(options.workbookPath)
    ? fs.realpathSync(options.workbookPath).toLowerCase() : "";
  const sourceFiles = [...new Set((history.downloads || []).map(record => record.filePath).filter(Boolean))];
  let removedCount = 0;
  const backupPaths = [];
  for (const filePath of sourceFiles) {
    try {
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !/\.(xlsx|xlsm|xls)$/i.test(filePath)) continue;
      const realPath = fs.realpathSync(filePath);
      const relative = path.relative(root, realPath);
      if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) continue;
      if (realPath.toLowerCase() === protectedWorkbook) continue;
      if (!isFileTodayOrLater(realPath, now)) {
        const backupPath = movePathToBackup(realPath, path.join(path.parse(realPath).root, "备份文件夹"), "旧下载源表", { date: now });
        backupPaths.push(backupPath);
        removedCount += 1;
      }
    } catch (error) {
      log("主线:失败", "批量汇总", "备份旧源文件", `已保留 ${filePath}：${error?.message || error}`);
    }
  }
  return { removedCount, backupPaths };
}

function resetTaskHistory(now) {
  // 这个函数只保留今天下载的记录，清空全部导入记录，避免旧记录干扰本轮复用与写入。
  const history = readTaskHistory();
  const todayText = formatLocalDayText(now);
  const retainedDownloads = (Array.isArray(history.downloads) ? history.downloads : [])
    .filter((record) => formatLocalDayText(record?.createdAt) === todayText);
  writeTaskHistory({ downloads: retainedDownloads, imports: [] });
  return {
    removedDownloadRecords: (Array.isArray(history.downloads) ? history.downloads : []).length - retainedDownloads.length,
    clearedImportRecords: (Array.isArray(history.imports) ? history.imports : []).length
  };
}

async function resetSummaryRunForToday({
  projectConfig,
  now = new Date(),
  clearDataDetailImplementation = clearSummaryData,
  logFn = log
}) {
  // 这个函数只在"开始全部汇总"预检通过后执行一次：清空数据明细、重置历史、清理今天以前源文件。
  const workbookPath = String(projectConfig?.workbook?.path || "").trim();
  if (workbookPath) {
    await clearDataDetailImplementation({ workbookPath });
  }
  const history = readTaskHistory();
  const downloadRootDir = String(projectConfig?.globalDefaults?.downloadRootDir || "").trim();
  const fileResult = cleanOldSourceFiles(downloadRootDir, now, { history, workbookPath });
  const historyResult = resetTaskHistory(now);
  logFn("主线:重置", "批量汇总", "本轮开始", `已清空数据明细、清空导入记录 ${historyResult.clearedImportRecords} 条、备份今天以前已登记源文件 ${fileResult.removedCount} 个。`);
  return {
    clearedDataDetail: Boolean(workbookPath),
    historyResult,
    fileResult
  };
}

module.exports = {
  resetSummaryRunForToday,
  cleanOldSourceFiles,
  resetTaskHistory,
  isFileTodayOrLater
};
