const fs = require("fs");
const path = require("path");
const scheduleQueryConfig = require("./scheduleQueryConfig");
const { matrixToTsv } = require("./scheduleMatrixParser");

function formatLocalDate(targetDate) {
  // 这里统一生成本地快照日期字符串，保证文件名和查询日期一致。
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeFileName(fileName) {
  // 这里清洗文件名里的非法字符，避免 Windows 落盘时报路径错误。
  return String(fileName || "未命名排班表").replace(/[\\/:*?"<>|]/g, "_");
}

function clearSnapshotDir(snapshotDir = scheduleQueryConfig.snapshotDir) {
  // 这里每次启动都先清空旧快照，避免目录里堆出冗余历史垃圾。
  if (!snapshotDir) {
    throw new Error("排班快照目录未配置，无法清理旧快照。");
  }

  fs.mkdirSync(snapshotDir, { recursive: true });

  for (const entry of fs.readdirSync(snapshotDir, { withFileTypes: true })) {
    // 这里显式区分文件和目录；Windows 下直接对普通文件走 rmSync 可能把 Node 进程带崩。
    const entryPath = path.join(snapshotDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      continue;
    }

    fs.unlinkSync(entryPath);
  }
}

function saveDailyScheduleSnapshot(
  targetDate,
  sheetTitle,
  matrix,
  snapshotDir = scheduleQueryConfig.snapshotDir,
  options = {}
) {
  // 这里把最新抓到的整张排班表落成本地快照，支持上层决定是否先清空旧文件。
  if (options.clearBeforeWrite !== false) {
    clearSnapshotDir(snapshotDir);
  } else {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  const snapshotFileName = `${formatLocalDate(targetDate)}-${sanitizeFileName(sheetTitle)}.tsv`;
  const snapshotPath = path.join(snapshotDir, snapshotFileName);
  fs.writeFileSync(snapshotPath, matrixToTsv(matrix), "utf8");
  return snapshotPath;
}

module.exports = {
  clearSnapshotDir,
  saveDailyScheduleSnapshot
};
