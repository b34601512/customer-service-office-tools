const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const appConfig = require("../../src/config/appConfig");

const originalAppConfig = {
  targetUrl: appConfig.targetUrl,
  replyConfigPath: appConfig.replyConfigPath,
  wecomRobotConfigPath: appConfig.wecomRobotConfigPath,
  appRuntimeConfigPath: appConfig.appRuntimeConfigPath
};

function buildReplyConfigContent() {
  // 这里生成最小生产配置副本，让配置中心保存测试不触碰真实配置文件。
  return `module.exports = {
  transferMonitorScanIntervalMs: 1500,
  missedReplyMonitorEnabled: true,
  onlinePresenceMonitorEnabled: true,
  onlinePresenceScanIntervalMs: 5000,
  onlinePresenceWorkStartTime: "08:00",
  missedReplyScanIntervalMs: 60000,
  missedReplyMaxContactsPerScan: 20,
  missedReplyTemporaryReplyKeywords: ["稍等", "1"],
  missedReplyCustomerResolutionKeywords: [{ text: "找到问题了", matchMode: "includes" }],
  missedReplyCustomerClosingKeywords: ["谢谢"],
  missedReplyInvalidAgentReplyKeywords: ["."],
  missedReplyPlatformNoticeKeywords: ["我已经添加了你"],
  timeoutReminderThresholdSeconds: 150,
  offDutyAutomationEnabled: true,
  offDutyScanIntervalMs: 30000,
  offDutyPreSalesEarlyStartTime: "08:00",
  offDutyPreSalesLateStartTime: "15:45",
  offDutyAfterSalesEarlyStartTime: "08:00",
  offDutyAfterSalesLateStartTime: "14:00",
  offDutyPreSalesEarlyCloseTime: "16:30",
  offDutyPreSalesLateCloseTime: "23:45",
  offDutyAfterSalesEarlyCloseTime: "16:30",
  offDutyAfterSalesLateCloseTime: "22:30",
  offDutyTomorrowShiftNotificationEnabled: false
};
`;
}

function loadControlCenterConfigServiceWithTempFiles() {
  // 这里切换到临时配置路径，并清理模块缓存，让服务读取本测试自己的配置副本。
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-keyword-config-"));
  appConfig.targetUrl = "https://example.com/main/org/group/chat";
  appConfig.replyConfigPath = path.join(tempDir, "reply-config.js");
  appConfig.wecomRobotConfigPath = path.join(tempDir, "wecom-robot.json");
  appConfig.appRuntimeConfigPath = path.join(tempDir, "app-config.json");
  fs.writeFileSync(appConfig.replyConfigPath, buildReplyConfigContent(), "utf8");
  fs.writeFileSync(appConfig.wecomRobotConfigPath, "{}\n", "utf8");

  delete require.cache[require.resolve("../../src/config/replyConfigLoader")];
  delete require.cache[require.resolve("../../src/controlCenter/controlCenterConfigService")];
  return {
    tempDir,
    service: require("../../src/controlCenter/controlCenterConfigService")
  };
}

function buildPayload(overrides = {}) {
  // 这里复用一份完整网页保存入参，让每个测试只关心自己改的字段。
  return {
    targetUrl: "https://example.com/main/org/group/chat",
    timeoutReminderThresholdSeconds: "150",
    missedReplyMonitorEnabled: true,
    onlinePresenceMonitorEnabled: true,
    onlinePresenceScanIntervalMs: "5000",
    onlinePresenceWorkStartTime: "08:00",
    missedReplyScanIntervalMs: "60000",
    missedReplyMaxContactsPerScan: "20",
    missedReplyTemporaryReplyKeywords: "稍等 | 完全匹配\n查一下 | 包含匹配\n1",
    missedReplyCustomerResolutionKeywords: "找到问题了 | 包含匹配",
    missedReplyCustomerClosingKeywords: "谢谢 | 完全匹配\n嗯 | 完全匹配",
    missedReplyInvalidAgentReplyKeywords: ". | 完全匹配\n, | 完全匹配",
    missedReplyPlatformNoticeKeywords: "我已经添加了你 | 开头匹配\n你已添加了 | 开头匹配",
    groupChatFilterEnabled: true,
    offDutyAutomationEnabled: true,
    offDutyScanIntervalMs: "30000",
    offDutyPreSalesEarlyStartTime: "08:00",
    offDutyPreSalesLateStartTime: "15:45",
    offDutyAfterSalesEarlyStartTime: "08:00",
    offDutyAfterSalesLateStartTime: "14:00",
    offDutyPreSalesEarlyCloseTime: "16:30",
    offDutyPreSalesLateCloseTime: "23:45",
    offDutyAfterSalesEarlyCloseTime: "16:30",
    offDutyAfterSalesLateCloseTime: "22:30",
    offDutyTomorrowShiftNotificationEnabled: false,
    ...overrides
  };
}

test.after(() => {
  appConfig.targetUrl = originalAppConfig.targetUrl;
  appConfig.replyConfigPath = originalAppConfig.replyConfigPath;
  appConfig.wecomRobotConfigPath = originalAppConfig.wecomRobotConfigPath;
  appConfig.appRuntimeConfigPath = originalAppConfig.appRuntimeConfigPath;
  delete require.cache[require.resolve("../../src/config/replyConfigLoader")];
  delete require.cache[require.resolve("../../src/controlCenter/controlCenterConfigService")];
});

test("配置中心保存关键词规则时应该保留每个关键词的匹配方式", () => {
  const { service } = loadControlCenterConfigServiceWithTempFiles();

  const result = service.saveControlCenterConfig(buildPayload());
  const content = fs.readFileSync(appConfig.replyConfigPath, "utf8");

  assert.deepEqual(result.missedReplyTemporaryReplyKeywords, [
    { text: "稍等", matchMode: "exact" },
    { text: "查一下", matchMode: "includes" },
    { text: "1", matchMode: "exact" }
  ]);
  assert.equal("missedReplyRecentContactLimit" in result, false);
  assert.deepEqual(result.missedReplyCustomerResolutionKeywords, [
    { text: "找到问题了", matchMode: "includes" }
  ]);
  assert.deepEqual(result.missedReplyPlatformNoticeKeywords, [
    { text: "我已经添加了你", matchMode: "startsWith" },
    { text: "你已添加了", matchMode: "startsWith" }
  ]);
  assert.equal(result.onlinePresenceScanIntervalMs, 5000);
  assert.equal(result.onlinePresenceWorkStartTime, "08:00");
  assert.doesNotMatch(content, /missedReplyRecentContactLimit/);
  assert.match(content, /onlinePresenceScanIntervalMs: 5000/);
  assert.match(content, /onlinePresenceWorkStartTime: "08:00"/);
  assert.match(content, /\{ text: "查一下", matchMode: "includes" \}/);
  assert.match(content, /\{ text: "找到问题了", matchMode: "includes" \}/);
  assert.match(content, /\{ text: ",", matchMode: "exact" \}/);
  assert.match(content, /\{ text: "你已添加了", matchMode: "startsWith" \}/);
});

test("配置中心保存关键词规则时写错匹配方式应该直接报错", () => {
  const { service } = loadControlCenterConfigServiceWithTempFiles();

  assert.throws(
    () => service.saveControlCenterConfig(buildPayload({
      missedReplyTemporaryReplyKeywords: "稍等 | 随便匹配"
    })),
    /匹配方式无效/
  );
});
