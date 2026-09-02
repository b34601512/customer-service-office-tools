// 该文件用于在采集前确认汇总表可以安全更新，避免店铺白跑和覆盖未保存内容。
const fs = require("fs");
const path = require("path");

function resolveWorkbookOwnerLockPath(workbookPath) {
  const normalizedWorkbookPath = path.resolve(String(workbookPath || ""));
  return path.join(path.dirname(normalizedWorkbookPath), `~$${path.basename(normalizedWorkbookPath)}`);
}

function buildWorkbookInUseError(workbookPath) {
  const error = new Error(
    `汇总表正在被WPS或Excel占用，请先保存并关闭「${path.basename(workbookPath)}」，再点击“开始汇总”。本轮未启动任何店铺。`
  );
  error.code = "WORKBOOK_IN_USE";
  return error;
}

function assertWorkbookAvailableForUpdate(workbookPath) {
  const normalizedWorkbookPath = path.resolve(String(workbookPath || ""));
  if (!fs.existsSync(normalizedWorkbookPath)) {
    throw new Error(`统一数据源不存在：${normalizedWorkbookPath}`);
  }
  if (fs.existsSync(resolveWorkbookOwnerLockPath(normalizedWorkbookPath))) {
    throw buildWorkbookInUseError(normalizedWorkbookPath);
  }
  fs.accessSync(normalizedWorkbookPath, fs.constants.R_OK | fs.constants.W_OK);
  return normalizedWorkbookPath;
}

module.exports = {
  resolveWorkbookOwnerLockPath,
  buildWorkbookInUseError,
  assertWorkbookAvailableForUpdate
};
