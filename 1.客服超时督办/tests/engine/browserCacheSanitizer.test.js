const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const appConfig = require("../../src/config/appConfig");
const {
  collectControlCenterBrowserDataDirs,
  sanitizeBrowserDataDirs
} = require("../../src/engine/browserCacheSanitizer");

test("控制台浏览器缓存目录应该独立于业务浏览器目录", () => {
  assert.deepEqual(collectControlCenterBrowserDataDirs(), [appConfig.controlCenterUserDataDir]);
});

test("缓存清理只应该删除可重建缓存，不应该删除登录态核心文件", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-cache-sanitizer-"));
  const browserDir = path.join(tempRoot, "browser-profile");
  const cacheDir = path.join(browserDir, "Default", "Cache");
  const safeBrowsingDir = path.join(browserDir, "Safe Browsing");
  const cookieDir = path.join(browserDir, "Default", "Network");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(safeBrowsingDir, { recursive: true });
  fs.mkdirSync(cookieDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "data_1"), "cache", "utf8");
  fs.writeFileSync(path.join(safeBrowsingDir, "UrlSoceng.store"), "component-cache", "utf8");
  fs.writeFileSync(path.join(cookieDir, "Cookies"), "login", "utf8");

  try {
    const result = sanitizeBrowserDataDirs([browserDir], "测试浏览器缓存");

    assert.equal(result.removedCount, 2);
    assert.equal(fs.existsSync(cacheDir), false);
    assert.equal(fs.existsSync(safeBrowsingDir), false);
    assert.equal(fs.readFileSync(path.join(cookieDir, "Cookies"), "utf8"), "login");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
