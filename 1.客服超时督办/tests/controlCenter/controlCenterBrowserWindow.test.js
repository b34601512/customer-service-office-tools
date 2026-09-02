const test = require("node:test");
const assert = require("node:assert/strict");

const appConfig = require("../../src/config/appConfig");
const {
  buildControlCenterBrowserArgs
} = require("../../src/controlCenter/controlCenterBrowserWindow");

test("控制台网页应该用独立 app 窗口启动", () => {
  const url = "http://127.0.0.1:39360";
  const args = buildControlCenterBrowserArgs(url);

  assert.ok(args.includes(`--user-data-dir=${appConfig.controlCenterUserDataDir}`));
  assert.ok(args.includes("--new-window"));
  assert.ok(args.includes(`--app=${url}`));
  assert.ok(args.includes("--disable-session-crashed-bubble"));
  assert.ok(args.includes("--disable-background-networking"));
  assert.ok(args.includes("--disable-component-update"));
  assert.ok(args.includes("--disable-sync"));
  assert.ok(args.includes("--disable-extensions"));
  assert.ok(args.includes(`--disk-cache-size=${appConfig.controlCenterBrowserDiskCacheSizeBytes}`));
});
