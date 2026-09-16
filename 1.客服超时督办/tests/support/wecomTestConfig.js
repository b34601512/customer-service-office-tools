// 该文件给测试提供彼此隔离的企微配置文件：每个测试文件用自己的临时文件，避免并发写同一个配置互相抢锁。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const appConfig = require("../../src/config/appConfig");

function buildIsolatedConfigPath(uniqueKey) {
  const suffix = String(uniqueKey || path.basename(process.argv[1] || "test"))
    .replace(/[^A-Za-z0-9_.-]/g, "_");
  return path.join(os.tmpdir(), `customer-service-wecom-${suffix}-${process.pid}.json`);
}

function useIsolatedWecomTestConfig(uniqueKey) {
  // 把 appConfig 指到本测试文件专属的临时配置，不碰真实 project-config。
  const configPath = buildIsolatedConfigPath(uniqueKey);
  appConfig.wecomRobotConfigPath = configPath;
  return configPath;
}

function writeWecomTestConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config));
  return configPath;
}

const DEFAULT_TEST_WECOM_CONFIG = {
  notification_groups: [
    {
      id: "group_all_staff",
      name: "小程序商城&客服对接群",
      webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
      enabled: true
    }
  ],
  member_directory: [
    { name: "黎路遥", mobile: "19900000000", user_id: "", inline_mention_enabled: true }
  ]
};

function setupIsolatedWecomTestConfig(uniqueKey) {
  const configPath = useIsolatedWecomTestConfig(uniqueKey);
  writeWecomTestConfig(configPath, DEFAULT_TEST_WECOM_CONFIG);
  return configPath;
}

module.exports = {
  DEFAULT_TEST_WECOM_CONFIG,
  setupIsolatedWecomTestConfig,
  useIsolatedWecomTestConfig,
  writeWecomTestConfig
};
