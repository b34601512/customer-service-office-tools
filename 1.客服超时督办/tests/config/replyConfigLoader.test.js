const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appConfig = require("../../src/config/appConfig");

const originalReplyConfigPath = appConfig.replyConfigPath;

function loadReplyConfigWithContent(content) {
  // 这里用临时配置文件验证默认值，避免单元测试改到真实生产配置。
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-config-loader-"));
  appConfig.replyConfigPath = path.join(tempDir, "reply-config.js");
  fs.writeFileSync(appConfig.replyConfigPath, content, "utf8");
  delete require.cache[require.resolve("../../src/config/replyConfigLoader")];
  return require("../../src/config/replyConfigLoader").loadReplyConfig();
}

test.after(() => {
  appConfig.replyConfigPath = originalReplyConfigPath;
  delete require.cache[require.resolve("../../src/config/replyConfigLoader")];
});

test("统一未回复监控缺少轮询配置时默认 5 秒读取一次", () => {
  const config = loadReplyConfigWithContent(`module.exports = {
  timeoutReminderThresholdSeconds: 150
};
`);

  assert.equal(config.missedReplyScanIntervalMs, 5000);
  assert.equal(config.missedReplyMaxContactsPerScan, 20);
  assert.deepEqual(config.missedReplyCustomerResolutionKeywords, [
    { text: "找到问题了", matchMode: "includes" }
  ]);
  assert.deepEqual(config.missedReplyUnreachableContactKeywords, [
    { text: "你还不是他（她）的联系人", matchMode: "includes" },
    { text: "你还不是他(她)的联系人", matchMode: "includes" },
    { text: "请先发送联系人验证请求，对方验证通过后，才能聊天", matchMode: "includes" }
  ]);
});

test("无人在线提醒缺少配置时应该默认启用并 5 秒扫描", () => {
  const config = loadReplyConfigWithContent(`module.exports = {
  timeoutReminderThresholdSeconds: 150
};
`);

  assert.equal(config.onlinePresenceMonitorEnabled, true);
  assert.equal(config.onlinePresenceScanIntervalMs, 5000);
  assert.equal(config.onlinePresenceWorkStartTime, "08:00");
  assert.equal(config.transferAutoOpenEnabled, true);
  assert.equal(config.transferAutoCloseEnabled, true);
});
