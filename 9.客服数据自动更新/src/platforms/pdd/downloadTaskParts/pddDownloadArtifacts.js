const fs = require("fs");
const path = require("path");
const { ensureDir } = require("../../../engine/fileSystem");

function resolvePddStoreDownloadDir(storeConfig) {
  // 这个函数只解析并创建当前拼多多店铺自己的下载目录。
  const downloadDir = String(storeConfig?.downloadDir || "").trim();
  if (!downloadDir) {
    throw new Error("当前拼多多店铺缺少下载目录，请在配置中心补齐。");
  }
  ensureDir(downloadDir);
  return downloadDir;
}

function isStablePddWorkbookFile(fileName) {
  // 这个函数只判断文件名是否为已完成的 Excel 下载文件。
  return /\.(xlsx|xlsm|xls)$/i.test(fileName || "") && !/\.(crdownload|tmp)$/i.test(fileName || "");
}

function listPddDownloadArtifacts(downloadDir) {
  // 这个函数只按修改时间倒序列出当前店铺目录里的稳定 Excel 文件。
  if (!downloadDir || !fs.existsSync(downloadDir)) {
    return [];
  }
  return fs
    .readdirSync(downloadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isStablePddWorkbookFile(entry.name))
    .map((entry) => {
      const fullPath = path.join(downloadDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        size: stat.size,
        modifiedAt: stat.mtimeMs
      };
    })
    .filter((item) => item.size > 0)
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
}

function listPddDownloadFileNames(downloadDir) {
  // 这个函数只记录触发下载前目录里已经存在的文件名。
  if (!downloadDir || !fs.existsSync(downloadDir)) {
    return new Set();
  }
  return new Set(
    fs.readdirSync(downloadDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  );
}

function resolvePddDownloadedPath(downloadArtifact) {
  // 这个函数只返回共享引擎已经确认落盘的真实文件。
  if (!downloadArtifact?.fullPath) {
    throw new Error("拼多多下载产物无效：指定目录没有返回真实文件。");
  }
  return downloadArtifact.fullPath;
}

module.exports = {
  resolvePddStoreDownloadDir,
  listPddDownloadArtifacts,
  listPddDownloadFileNames,
  resolvePddDownloadedPath
};
