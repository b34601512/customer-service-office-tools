// 该文件用于解决旧店铺级 Chrome 资料目录迁移到账号级资料目录的问题。
const fs = require("fs");
const path = require("path");
const { log } = require("./logger");
const { ensureDir } = require("./fileSystem");

function isAccountProfileDirName(dirName) {
  // 该函数用于识别新结构账号目录，避免把已有账号目录再次搬进别的账号目录。
  const text = String(dirName || "").trim();
  return text === "manual" || /^account-[a-f0-9]{12}$/.test(text);
}

function isLegacyChromeProfileEntry(entryName) {
  // 该函数用于识别旧 Chrome 资料目录里的真实资料文件，而不是新账号目录。
  const text = String(entryName || "").trim();
  return Boolean(text) && !isAccountProfileDirName(text);
}

function listLegacyChromeProfileEntries(storeProfileDir, accountProfileDir) {
  // 该函数用于列出需要从店铺根目录迁移到账号目录的旧资料项。
  if (!fs.existsSync(storeProfileDir) || !fs.statSync(storeProfileDir).isDirectory()) {
    return [];
  }

  const normalizedAccountDir = path.resolve(accountProfileDir);
  return fs.readdirSync(storeProfileDir)
    .filter((entryName) => isLegacyChromeProfileEntry(entryName))
    .map((entryName) => ({
      name: entryName,
      sourcePath: path.join(storeProfileDir, entryName),
      targetPath: path.join(accountProfileDir, entryName)
    }))
    .filter((entry) => path.resolve(entry.sourcePath) !== normalizedAccountDir);
}

function hasChromeProfileMarker(entries) {
  // 该函数用于确认店铺根目录确实是旧 Chrome 资料目录，避免误搬普通空目录。
  return entries.some((entry) => ["Default", "Local State", "BrowserMetrics"].includes(entry.name));
}

function isDirectoryEmpty(dirPath) {
  // 该函数用于判断账号目录是否还是空目录，只有空目录才允许承接旧登录态。
  return !fs.existsSync(dirPath) || fs.readdirSync(dirPath).length === 0;
}

function migrateLegacyStoreChromeProfileToAccountDir(options = {}) {
  // 该函数用于把旧的店铺级登录态搬进当前账号目录，让升级后不需要重新登录一次。
  const userDataDir = String(options.userDataDir || "").trim();
  const accountProfileKey = String(options.accountProfileKey || "").trim();
  if (!userDataDir || !isAccountProfileDirName(accountProfileKey) || path.basename(userDataDir) !== accountProfileKey) {
    return false;
  }

  const accountProfileDir = path.resolve(userDataDir);
  const storeProfileDir = path.dirname(accountProfileDir);
  const entries = listLegacyChromeProfileEntries(storeProfileDir, accountProfileDir);
  if (!entries.length || !hasChromeProfileMarker(entries) || !isDirectoryEmpty(accountProfileDir)) {
    return false;
  }

  ensureDir(accountProfileDir);
  for (const entry of entries) {
    if (fs.existsSync(entry.targetPath)) {
      throw new Error(`迁移旧浏览器资料失败：账号目录里已存在同名资料项「${entry.name}」。`);
    }
    fs.renameSync(entry.sourcePath, entry.targetPath);
  }

  log(
    "主线:完成",
    "浏览器资料",
    "账号目录迁移",
    `已把旧店铺级浏览器资料迁移到账号目录：${accountProfileDir}`
  );
  return true;
}

module.exports = {
  migrateLegacyStoreChromeProfileToAccountDir,
  __test__: {
    migrateLegacyStoreChromeProfileToAccountDir
  }
};
