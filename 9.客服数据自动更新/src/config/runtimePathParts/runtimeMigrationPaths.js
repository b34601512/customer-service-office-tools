// 该文件用于解决历史 runtime 来源路径到当前布局的迁移改写问题。
const path = require("path");
const { createRuntimeLayout } = require("./currentRuntimeLayout");

function joinPlatformDir(rootPath, platformKey) {
  return path.join(rootPath, String(platformKey || "").trim());
}

function createRuntimeMigrationSourceLayout(projectRoot) {
  const runtimeRoot = path.join(projectRoot, "runtime");
  const downloadsRoot = path.join(runtimeRoot, "downloads");
  const snapshotsRoot = path.join(runtimeRoot, "snapshots");
  return {
    root: runtimeRoot,
    chromeUserDataDir: path.join(runtimeRoot, "chrome-user-data"),
    chromePidPath: path.join(runtimeRoot, "chrome.pid"),
    taskHistoryPath: path.join(runtimeRoot, "task-history.json"),
    downloadsRoot,
    snapshotsRoot,
    getPlatformDownloadDir(platformKey) {
      return joinPlatformDir(downloadsRoot, platformKey);
    },
    getPlatformDownloadRunDir(platformKey) {
      return path.join(downloadsRoot, String(platformKey || "").trim(), "_runs");
    },
    getPlatformSnapshotDir(platformKey) {
      return joinPlatformDir(snapshotsRoot, platformKey);
    }
  };
}

function normalizeComparablePath(targetPath) {
  const resolvedPath = path.resolve(String(targetPath || ""));
  return resolvedPath.replace(/[\\/]+$/, "").toLowerCase();
}

function isSameOrChildPath(basePath, targetPath) {
  const normalizedBasePath = normalizeComparablePath(basePath);
  const normalizedTargetPath = normalizeComparablePath(targetPath);
  if (!normalizedBasePath || !normalizedTargetPath) {
    return false;
  }
  return normalizedTargetPath === normalizedBasePath || normalizedTargetPath.startsWith(`${normalizedBasePath}${path.sep}`);
}

function buildRuntimeMigrationRemapRules(projectRoot) {
  const currentLayout = createRuntimeLayout(projectRoot);
  const sourceLayout = createRuntimeMigrationSourceLayout(projectRoot);
  return [
    [sourceLayout.getPlatformDownloadRunDir("tmall"), currentLayout.cache.getPlatformDownloadRunDir("tmall")],
    [sourceLayout.getPlatformDownloadRunDir("jd"), currentLayout.cache.getPlatformDownloadRunDir("jd")],
    [sourceLayout.getPlatformDownloadRunDir("pdd"), currentLayout.cache.getPlatformDownloadRunDir("pdd")],
    [sourceLayout.downloadsRoot, currentLayout.output.downloadsRoot],
    [sourceLayout.snapshotsRoot, currentLayout.cache.snapshotsRoot],
    [sourceLayout.chromeUserDataDir, currentLayout.state.browserProfiles.chromeUserDataDir],
    [sourceLayout.chromePidPath, currentLayout.state.process.chromePidPath],
    [sourceLayout.taskHistoryPath, currentLayout.state.history.taskHistoryPath]
  ];
}

function remapRuntimeMigrationPath(projectRoot, targetPath) {
  const rawPath = String(targetPath || "").trim();
  if (!rawPath || !path.isAbsolute(rawPath)) {
    return rawPath;
  }
  for (const [sourceBasePath, currentBasePath] of buildRuntimeMigrationRemapRules(projectRoot)) {
    if (!isSameOrChildPath(sourceBasePath, rawPath)) {
      continue;
    }
    const relativePath = path.relative(sourceBasePath, rawPath);
    return relativePath ? path.join(currentBasePath, relativePath) : currentBasePath;
  }
  return rawPath;
}

module.exports = {
  createRuntimeMigrationSourceLayout,
  remapRuntimeMigrationPath
};
