// 该文件用于解决店铺浏览器账号身份键和独立资料目录的生成问题。
const crypto = require("crypto");
const path = require("path");

function buildStoreAccountChromeProfileKey(username) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return "manual";
  }
  const digest = crypto.createHash("sha256").update(normalizedUsername, "utf8").digest("hex").slice(0, 12);
  return `account-${digest}`;
}

function buildStoreScopedChromeProfileKey(platformKey, storeKey, username) {
  const normalizedUsername = String(username || "").trim();
  if (normalizedUsername) {
    return buildStoreAccountChromeProfileKey(normalizedUsername);
  }
  const scopedStoreIdentity = `${String(platformKey || "").trim()}:${String(storeKey || "").trim()}`;
  const digest = crypto.createHash("sha256").update(scopedStoreIdentity, "utf8").digest("hex").slice(0, 12);
  return `store-${digest}`;
}

function joinStoreAccountChromeUserDataDir(rootPath, platformKey, storeKey, username) {
  return path.join(
    rootPath,
    String(platformKey || "").trim(),
    String(storeKey || "").trim(),
    buildStoreScopedChromeProfileKey(platformKey, storeKey, username)
  );
}

module.exports = {
  buildStoreAccountChromeProfileKey,
  buildStoreScopedChromeProfileKey,
  joinStoreAccountChromeUserDataDir
};
