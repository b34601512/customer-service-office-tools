// 该文件只负责抖音下载目录、Excel 快照、同名覆盖识别与文件落盘。
const fs = require("fs");
const path = require("path");
const { ensureDir } = require("../../../engine/fileSystem");

function resolveStoreDownloadDir(storeConfig) {
  // 抖音下载必须落到当前店铺目录，避免多店导出文件互相污染。
  const downloadDir = String(storeConfig?.downloadDir || "").trim();
  if (!downloadDir) {
    throw new Error("当前抖音店铺缺少下载目录，请先在配置页补齐。");
  }
  ensureDir(downloadDir);
  return downloadDir;
}

function listWorkbookArtifacts(downloadDir) {
  // 这里只识别稳定 Excel 文件，忽略浏览器临时下载后缀。
  if (!downloadDir || !fs.existsSync(downloadDir)) {
    return [];
  }
  return fs.readdirSync(downloadDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => /\.(xlsx|xlsm|xls)$/i.test(entry.name) && !/\.(crdownload|tmp)$/i.test(entry.name))
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

function snapshotWorkbookArtifacts(downloadDir) {
  // 抖音会重复导出同一个文件名，必须同时记录修改时间，不能只按文件名判断新文件。
  return new Map(listWorkbookArtifacts(downloadDir).map((item) => [item.name, item]));
}

function isWorkbookArtifactChanged(artifact, beforeSnapshot) {
  // 用统一快照识别新增或同名覆盖的文件，避免重复导出被当成旧文件。
  const previousArtifact = beforeSnapshot.get(artifact.name);
  if (!previousArtifact) {
    return true;
  }
  return artifact.modifiedAt > previousArtifact.modifiedAt || artifact.size !== previousArtifact.size;
}

function findNewArtifact(downloadDir, beforeSnapshot) {
  // 该函数只从当前目录找到第一份新增或同名覆盖的 Excel 文件。
  return listWorkbookArtifacts(downloadDir).find((item) => isWorkbookArtifactChanged(item, beforeSnapshot)) || null;
}

async function enableDownloadBehavior(page, downloadDir) {
  // 这里显式设置下载目录，保证浏览器真实导出文件进入当前店铺目录。
  ensureDir(downloadDir);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadDir
  });
}

function resolveDouyinDownloadedPath(downloadArtifact) {
  // 这个函数只返回共享引擎已经确认落盘的真实文件。
  if (!downloadArtifact?.fullPath) {
    throw new Error("抖音下载产物无效：指定目录没有返回真实文件。");
  }
  return downloadArtifact.fullPath;
}

function sanitizeDouyinFileNamePart(value, fallbackValue) {
  // 该函数只把配置标识转换为 Windows 可用的单段文件名。
  const sanitizedValue = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "");
  return sanitizedValue || fallbackValue;
}

function formatDouyinArtifactTimestamp(date = new Date()) {
  // 毫秒时间戳保证同店同日重复导出也不会覆盖历史文件。
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    pad(date.getMilliseconds(), 3)
  ].join("");
}

function buildUniqueDouyinArtifactPath(downloadedPath, storeConfig, exportRange, date = new Date()) {
  // 文件名同时保留日期、本地店铺键和平台店铺 ID，彻底脱离平台同名文件。
  const downloadDir = path.dirname(downloadedPath);
  const extension = path.extname(downloadedPath) || ".xlsx";
  const startDate = sanitizeDouyinFileNamePart(exportRange?.startText, "开始日期").replace(/-/g, "");
  const endDate = sanitizeDouyinFileNamePart(exportRange?.endText, "结束日期").replace(/-/g, "");
  const storeKey = sanitizeDouyinFileNamePart(storeConfig?.key, "未知店铺");
  const platformStoreId = sanitizeDouyinFileNamePart(storeConfig?.platformStoreId, "未绑定ID");
  const timestamp = formatDouyinArtifactTimestamp(date);
  const baseName = `${startDate}-${endDate}-抖音客服数据-${storeKey}-${platformStoreId}-${timestamp}`;
  let candidatePath = path.join(downloadDir, `${baseName}${extension}`);
  let collisionIndex = 1;
  while (fs.existsSync(candidatePath) && path.resolve(candidatePath) !== path.resolve(downloadedPath)) {
    candidatePath = path.join(downloadDir, `${baseName}-${collisionIndex}${extension}`);
    collisionIndex += 1;
  }
  return candidatePath;
}

function finalizeDouyinDownloadedPath(downloadArtifact, storeConfig, exportRange, date = new Date()) {
  // 这里只移动刚确认落盘的文件到唯一名称，不覆盖、不删除任何历史文件。
  const downloadedPath = resolveDouyinDownloadedPath(downloadArtifact);
  const finalPath = buildUniqueDouyinArtifactPath(downloadedPath, storeConfig, exportRange, date);
  if (path.resolve(downloadedPath) !== path.resolve(finalPath)) {
    fs.renameSync(downloadedPath, finalPath);
  }
  return finalPath;
}

module.exports = {
  resolveStoreDownloadDir,
  snapshotWorkbookArtifacts,
  findNewArtifact,
  enableDownloadBehavior,
  resolveDouyinDownloadedPath,
  buildUniqueDouyinArtifactPath,
  finalizeDouyinDownloadedPath
};
