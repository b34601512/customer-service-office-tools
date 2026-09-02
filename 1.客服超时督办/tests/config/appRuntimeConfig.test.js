const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_TARGET_URL,
  assertFullTargetUrl,
  readAppRuntimeConfig,
  resolveLoginEntryUrl,
  resolveWorkEntryUrl,
  writeAppRuntimeConfig
} = require("../../src/config/appRuntimeConfig");

function createTempConfigPath() {
  // 这里给每个测试独立配置目录，避免测试之间互相污染。
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-runtime-config-")), "app-config.json");
}

test("运行配置不存在时应该使用默认客服工作台地址", () => {
  const configPath = createTempConfigPath();

  const config = readAppRuntimeConfig(configPath);

  assert.equal(config.targetUrl, DEFAULT_TARGET_URL);
});

test("运行配置应该能保存并读回客服工作台地址", () => {
  const configPath = createTempConfigPath();
  const targetUrl = "https://zan-mh.xiaoshunai.com/main/org-id/group-id/chat";

  writeAppRuntimeConfig(configPath, { targetUrl });
  const config = readAppRuntimeConfig(configPath);

  assert.equal(config.targetUrl, targetUrl);
});

test("运行配置应该允许先保存入口域名", () => {
  const configPath = createTempConfigPath();
  const targetUrl = "https://zan-mh.xiaoshunai.com/";

  writeAppRuntimeConfig(configPath, { targetUrl });
  const config = readAppRuntimeConfig(configPath);

  assert.equal(config.targetUrl, targetUrl);
});

test("运行配置不应该长期保存 closeLogin 登录入口", () => {
  const configPath = createTempConfigPath();

  writeAppRuntimeConfig(configPath, { targetUrl: "https://zan-mh.xiaoshunai.com/closeLogin" });
  const config = readAppRuntimeConfig(configPath);

  assert.equal(config.targetUrl, "https://zan-mh.xiaoshunai.com/");
});

test("后台执行前发现地址不是完整聊天页时应该直接抛中文错误", () => {
  const configPath = createTempConfigPath();

  fs.writeFileSync(configPath, JSON.stringify({ targetUrl: "https://example.com/not-chat" }), "utf8");

  const config = readAppRuntimeConfig(configPath);
  assert.throws(
    () => assertFullTargetUrl(config.targetUrl),
    /客服工作台地址还不是完整聊天页/
  );
});

test("非完整地址首次登录时应该改走 closeLogin 入口", () => {
  assert.equal(
    resolveLoginEntryUrl("https://zan-mh.xiaoshunai.com/main"),
    "https://zan-mh.xiaoshunai.com/closeLogin"
  );
});

test("完整聊天页重新登录时也应该改走 closeLogin 入口", () => {
  assert.equal(
    resolveLoginEntryUrl("https://zan-mh.xiaoshunai.com/main/org-id/group-id/chat"),
    "https://zan-mh.xiaoshunai.com/closeLogin"
  );
});

test("非完整地址后台运行时应该先走 main 复用登录态", () => {
  assert.equal(
    resolveWorkEntryUrl("https://zan-mh.xiaoshunai.com/closeLogin"),
    "https://zan-mh.xiaoshunai.com/main"
  );
});

test("完整聊天页后台运行时应该直接沿用原地址", () => {
  const targetUrl = "https://zan-mh.xiaoshunai.com/main/org-id/group-id/chat";

  assert.equal(resolveWorkEntryUrl(targetUrl), targetUrl);
});
