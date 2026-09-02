// 该文件只负责项目配置中的下载根目录、平台目录与店铺隔离路径。
const path = require("path");
const appConfig = require("../appConfig");
const { remapRuntimeMigrationPath } = require("../runtimePathParts/runtimeMigrationPaths");
const { normalizeString } = require("./projectConfigValuePrimitives");

function normalizeComparablePath(targetPath) {
  // 该函数只把路径规范化为可比较的绝对小写形式。
  return path.resolve(String(targetPath || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function isSamePath(leftPath, rightPath) {
  // 该函数只判断两个非空路径是否指向同一位置。
  const normalizedLeftPath = normalizeComparablePath(leftPath);
  const normalizedRightPath = normalizeComparablePath(rightPath);
  if (!normalizedLeftPath || !normalizedRightPath) {
    return false;
  }

  return normalizedLeftPath === normalizedRightPath;
}

function getRuntimeStoreDownloadDir(platformKey, storeKey) {
  // 该函数只读取当前项目为指定店铺分配的下载目录。
  return appConfig.getStoreDownloadDir(platformKey, storeKey);
}

function getRuntimePlatformDownloadDir(platformKey) {
  // 该函数只读取当前项目指定平台的下载目录。
  return appConfig.runtime.output.getPlatformDownloadDir(platformKey);
}

function getRuntimeDownloadRootDir() {
  // 该函数只读取当前项目统一的下载根目录。
  return appConfig.runtime.output.downloadsRoot;
}

function hasRuntimeDownloadRootSignature(downloadRootDir) {
  // 这里只识别本项目托管下载根目录签名，避免总下载目录继续绑定旧项目盘符。
  const pathSegments = normalizeString(downloadRootDir)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]+/)
    .map((segment) => segment.toLowerCase())
    .filter(Boolean);

  if (pathSegments.length < 2) {
    return false;
  }

  return pathSegments.some((segment, index) => {
    const isCurrentRuntimeOutput =
      segment === "runtime" &&
      pathSegments[index + 1] === "output" &&
      pathSegments[index + 2] === "downloads";
    const isLegacyRuntimeDownloads =
      segment === "runtime" &&
      pathSegments[index + 1] === "downloads";

    return isCurrentRuntimeOutput || isLegacyRuntimeDownloads;
  });
}

function resolveDownloadRootDir(downloadRootDir, fallbackDownloadRootDir = "") {
  // 这里统一解析总下载根目录，项目托管路径跟随当前项目，外部自定义目录原样保留。
  const remappedDownloadRootDir = remapRuntimeMigrationPath(
    appConfig.projectRoot,
    normalizeString(downloadRootDir || fallbackDownloadRootDir)
  );
  if (!remappedDownloadRootDir) {
    return getRuntimeDownloadRootDir();
  }

  if (hasRuntimeDownloadRootSignature(remappedDownloadRootDir)) {
    return getRuntimeDownloadRootDir();
  }

  return remappedDownloadRootDir;
}

function buildStoreDownloadDirFromRoot(downloadRootDir, platformKey, storeKey) {
  // 这里按“总下载根目录/平台/店铺”生成店铺下载目录，保证同步规则只有一条。
  const normalizedRootDir = normalizeString(downloadRootDir) || getRuntimeDownloadRootDir();
  const normalizedPlatformKey = normalizeString(platformKey);
  const normalizedStoreKey = normalizeString(storeKey);
  if (!normalizedPlatformKey || !normalizedStoreKey) {
    throw new Error(`生成店铺下载目录失败：平台或店铺标识缺失。平台=${platformKey}，店铺=${storeKey}`);
  }

  const rootSegments = normalizedRootDir.replace(/[\\/]+$/, "").split(/[\\/]+/).filter(Boolean);
  const lastRootSegment = String(rootSegments[rootSegments.length - 1] || "").toLowerCase();
  if (lastRootSegment === normalizedPlatformKey.toLowerCase()) {
    return path.join(normalizedRootDir, normalizedStoreKey);
  }

  return path.join(normalizedRootDir, normalizedPlatformKey, normalizedStoreKey);
}

function hasRuntimeDownloadPathSignature(platformKey, downloadDir) {
  // 这里只识别本项目托管的 runtime 下载目录签名，避免项目搬家后继续使用旧盘符。
  const normalizedPlatformKey = normalizeString(platformKey).toLowerCase();
  const pathSegments = normalizeString(downloadDir)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]+/)
    .map((segment) => segment.toLowerCase())
    .filter(Boolean);

  if (!normalizedPlatformKey || pathSegments.length < 3) {
    return false;
  }

  return pathSegments.some((segment, index) => {
    const isCurrentRuntimeOutput =
      segment === "runtime" &&
      pathSegments[index + 1] === "output" &&
      pathSegments[index + 2] === "downloads" &&
      pathSegments[index + 3] === normalizedPlatformKey;
    const isLegacyRuntimeDownloads =
      segment === "runtime" &&
      pathSegments[index + 1] === "downloads" &&
      pathSegments[index + 2] === normalizedPlatformKey;

    return isCurrentRuntimeOutput || isLegacyRuntimeDownloads;
  });
}

function resolvePortableStoreDownloadDir(platformKey, storeKey, downloadDir) {
  // 这里把旧项目目录里的 runtime 下载路径迁移到当前项目目录，保留真正的外部自定义目录。
  const normalizedDownloadDir = normalizeString(downloadDir);
  if (!normalizedDownloadDir) {
    return normalizedDownloadDir;
  }

  if (hasRuntimeDownloadPathSignature(platformKey, normalizedDownloadDir)) {
    return getRuntimeStoreDownloadDir(platformKey, storeKey);
  }

  return normalizedDownloadDir;
}

function resolveStoreRelativeDownloadSegments(platformKey, downloadDir) {
  // 该函数只读取下载目录相对平台目录的安全子路径段。
  const platformDownloadDir = getRuntimePlatformDownloadDir(platformKey);
  if (!downloadDir || !platformDownloadDir) {
    return [];
  }

  if (!isSamePath(downloadDir, platformDownloadDir)) {
    const relativePath = path.relative(platformDownloadDir, downloadDir);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      return [];
    }

    return relativePath.split(/[\\/]+/).filter(Boolean);
  }

  return [];
}

function resolveStoreDownloadDir(platformKey, storeKey, downloadDir, fallbackDownloadDir = "") {
  // 这里把非隔离下载目录收口成按店铺隔离的目录，避免不同店铺继续写进同一层。
  const normalizedPlatformKey = normalizeString(platformKey);
  const normalizedStoreKey = normalizeString(storeKey);
  if (!normalizedPlatformKey || !normalizedStoreKey) {
    throw new Error(`下载目录规范化失败：平台或店铺标识缺失。平台=${platformKey}，店铺=${storeKey}`);
  }

  const isolatedDownloadDir = getRuntimeStoreDownloadDir(normalizedPlatformKey, normalizedStoreKey);
  const remappedDownloadDir = remapRuntimeMigrationPath(
    appConfig.projectRoot,
    normalizeString(downloadDir || fallbackDownloadDir)
  );
  const rawDownloadDir = resolvePortableStoreDownloadDir(
    normalizedPlatformKey,
    normalizedStoreKey,
    remappedDownloadDir
  );
  if (!rawDownloadDir) {
    return isolatedDownloadDir;
  }

  if (isSamePath(rawDownloadDir, getRuntimePlatformDownloadDir(normalizedPlatformKey))) {
    return isolatedDownloadDir;
  }

  const relativeSegments = resolveStoreRelativeDownloadSegments(normalizedPlatformKey, rawDownloadDir);
  if (relativeSegments.length === 1 && relativeSegments[0] !== normalizedStoreKey) {
    return isolatedDownloadDir;
  }

  return rawDownloadDir;
}

module.exports = {
  normalizeComparablePath,
  isSamePath,
  getRuntimeStoreDownloadDir,
  getRuntimePlatformDownloadDir,
  getRuntimeDownloadRootDir,
  hasRuntimeDownloadRootSignature,
  resolveDownloadRootDir,
  buildStoreDownloadDirFromRoot,
  hasRuntimeDownloadPathSignature,
  resolvePortableStoreDownloadDir,
  resolveStoreRelativeDownloadSegments,
  resolveStoreDownloadDir
};
