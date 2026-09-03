// 本文件是配置业务真源：加载、校验、保存平台/店铺/提醒源/值班@配置，界面只调用这里。
const appConfig = require("../config/appConfig");
const { readJson, writeJsonAtomic, ensureDir } = require("../engine/fileSystem");
const path = require("path");

const VALID_SOURCE_TYPES = new Set(["jingxiWorkOrder", "popDispute"]);

function assertText(value, message) {
  if (!String(value || "").trim()) {
    throw new Error(`配置校验失败：${message}`);
  }
}

function validateConfig(config) {
  assertText(config.wecom && config.wecom.webhookUrl, "缺少企微机器人 webhookUrl");
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\//.test(config.wecom.webhookUrl)) {
    throw new Error("配置校验失败：企微 webhookUrl 格式不正确");
  }
  const monitor = config.monitor || {};
  if (!(Number(monitor.intervalMinutes) > 0)) {
    throw new Error("配置校验失败：monitor.intervalMinutes 必须大于 0");
  }
  if (Number(monitor.loginAlertThrottleMinutes) < 0) {
    throw new Error("配置校验失败：monitor.loginAlertThrottleMinutes 不能为负数");
  }
  if (monitor.verdictPendingRepeatMinutes !== undefined && Number(monitor.verdictPendingRepeatMinutes) < 0) {
    throw new Error("配置校验失败：monitor.verdictPendingRepeatMinutes 不能为负数（0=关闭判责未出重发）");
  }
  let storeCount = 0;
  for (const [platformKey, platform] of Object.entries(config.platforms || {})) {
    for (const store of platform.stores || []) {
      storeCount += 1;
      assertText(store.key, `平台 ${platformKey} 存在缺少 key 的店铺`);
      assertText(store.displayName, `店铺 ${store.key} 缺少 displayName`);
      assertText(store.username, `店铺 ${store.displayName} 缺少 username（京麦/平台账号，用于登录辅助提示）`);
      const sources = store.sources || [];
      if (sources.length === 0) {
        throw new Error(`配置校验失败：店铺 ${store.displayName} 没有配置任何提醒源`);
      }
      for (const source of sources) {
        assertText(source.key, `店铺 ${store.displayName} 存在缺少 key 的提醒源`);
        assertText(source.url, `店铺 ${store.displayName}/${source.key} 缺少 url`);
        if (!VALID_SOURCE_TYPES.has(source.type)) {
          throw new Error(`配置校验失败：店铺 ${store.displayName}/${source.key} 类型 ${source.type} 不支持，目前支持：${[...VALID_SOURCE_TYPES].join("、")}`);
        }
        if (!Array.isArray(source.watch) || source.watch.length === 0) {
          throw new Error(`配置校验失败：店铺 ${store.displayName}/${source.key} 缺少 watch 页签列表`);
        }
      }
    }
  }
  if (storeCount === 0) {
    throw new Error("配置校验失败：至少需要一个店铺");
  }
  // 值班@配置（可选模块）：一旦配置就必须完整，避免半残配置运行后默默不@人。
  // 规则（按天）：组长当日在班→@组长；其他售后看背景标记色；主管永远@。
  if (config.duty) {
    assertText(config.duty.scheduleUrl, "duty.scheduleUrl 缺少（金山排班表链接）");
    assertText(config.duty.group, "duty.group 缺少（要@的客服组，如 售后）");
    const memberMap = (config.wecom && config.wecom.memberMobileMap) || {};
    if (!Array.isArray(config.duty.managerNames) || config.duty.managerNames.length === 0) {
      throw new Error("配置校验失败：duty.managerNames 至少填一人（如 黎路遥）");
    }
    if (!Array.isArray(config.duty.leadNames) || config.duty.leadNames.length === 0) {
      throw new Error("配置校验失败：duty.leadNames 至少填一人（值班组长，如 李守耀）");
    }
    for (const name of [...config.duty.managerNames, ...config.duty.leadNames]) {
      if (!String(memberMap[name] || "").trim()) {
        throw new Error(`配置校验失败：「${name}」在 wecom.memberMobileMap 里没有手机号，无法@`);
      }
    }
  }
  return config;
}

function loadConfig() {
  const raw = readJson(appConfig.projectConfigPath, null);
  if (!raw) {
    throw new Error(
      `未找到配置文件 ${appConfig.projectConfigPath}，请复制 platform-config.example.json 为 platform-config.json 并填写店铺与企微配置。`
    );
  }
  return validateConfig(raw);
}

function saveConfig(config) {
  validateConfig(config);
  ensureDir(path.dirname(appConfig.projectConfigPath));
  writeJsonAtomic(appConfig.projectConfigPath, config);
  return config;
}

function iterateEnabledSources(config) {
  const items = [];
  for (const [platformKey, platform] of Object.entries(config.platforms || {})) {
    for (const store of platform.stores || []) {
      if (store.enabled === false) continue;
      for (const source of store.sources || []) {
        items.push({ platformKey, platform, store, source });
      }
    }
  }
  return items;
}

module.exports = { loadConfig, saveConfig, validateConfig, iterateEnabledSources, VALID_SOURCE_TYPES };
