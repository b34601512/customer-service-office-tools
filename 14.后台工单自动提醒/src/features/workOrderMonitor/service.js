// 本文件是工单监控业务总入口（真源）：巡检一轮 = 探测各店 → 判定事件 → 发企微 → 落状态。
// TUI/命令行/AI 全部调用这里的同一组函数，界面零业务（#624 边界）。

const appConfig = require("../../config/appConfig");
const { loadConfig, iterateEnabledSources } = require("../../config/projectConfigService");
const { readJson, writeJsonAtomic, appendJsonl } = require("../../engine/fileSystem");
const { log } = require("../../engine/logger");
const { sendWecomText } = require("../../integrations/wecomRobot");
const { probeStore } = require("./pageProbe");
const { evaluateRound, STATUS } = require("./alertPolicy");
const { buildAlertMessage } = require("./messageText");

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceIdOf(platformKey, storeKey, sourceKey) {
  return `${platformKey}/${storeKey}/${sourceKey}`;
}

function loadMonitorState() {
  return readJson(appConfig.monitorStatePath, { sources: {}, lastRoundAt: 0 });
}

function saveMonitorState(state) {
  writeJsonAtomic(appConfig.monitorStatePath, state);
}

// 执行一轮完整巡检。dryRun=true 时只判定不发送不改基线（供测试与预览）。
// probeStoreImpl/sendTextImpl 仅依赖注入点：测试/AI 可传假实现跑同一条真实链路（#2705）。
async function monitorOnce(options = {}) {
  const config = options.configOverride || loadConfig();
  const probeStoreImpl = options.probeStoreImpl || probeStore;
  const sendTextImpl = options.sendTextImpl || sendWecomText;
  const state = deepClone(loadMonitorState());
  const prevSnapshot = deepClone(state);
  const sources = iterateEnabledSources(config);
  const timeoutMs = (Number(config.monitor.pageLoadTimeoutSeconds) || 45) * 1000;

  const observations = {};
  const storesByPlatform = new Map();
  for (const item of sources) {
    const list = storesByPlatform.get(item.platformKey) || [];
    if (!list.includes(item.store)) list.push(item.store);
    storesByPlatform.set(item.platformKey, list);
  }

  for (const [platformKey, stores] of storesByPlatform) {
    for (const store of stores) {
      let results = {};
      try {
        results = await probeStoreImpl(platformKey, store, timeoutMs);
      } catch (error) {
        // 单店失败隔离（#624 边界）：记为页面异常，不阻塞其他店铺。
        log("巡检", store.displayName, "店铺探测失败", error.message);
        for (const source of store.sources) {
          results[source.key] = { status: STATUS.PAGE_ERROR, counts: {}, error: error.message };
        }
      }
      for (const source of store.sources) {
        const id = sourceIdOf(platformKey, store.key, source.key);
        observations[id] = {
          ...(results[source.key] || { status: STATUS.PAGE_ERROR, counts: {} }),
          meta: {
            platformName: config.platforms[platformKey].displayName || platformKey,
            storeName: store.displayName,
            sourceName: source.displayName || source.key,
            url: source.url,
            watch: source.watch,
            mentionedMobileList: store.mentionedMobileList || []
          }
        };
      }
    }
  }

  const events = evaluateRound(state, observations, {
    loginAlertThrottleMinutes: config.monitor.loginAlertThrottleMinutes,
    repeatReminderMinutes: config.monitor.repeatReminderMinutes,
    alertOnFirstRun: config.monitor.alertOnFirstRun !== false
  }, new Date());
  // 注意：这里不立即落盘。dryRun 绝不改基线；真实运行要等发送结果确定后再写，避免演练吞事件、发送失败丢提醒。

  const failedSourceIds = new Set();
  const sent = [];
  for (const event of events) {
    const content = buildAlertMessage(event);
    if (options.dryRun) {
      log("巡检", event.sourceId, "事件(演练不发送)", content.replace(/\n/g, " ⏎ "));
      sent.push({ event, content, ok: true, dryRun: true });
      continue;
    }
    try {
      await sendTextImpl(
        config.wecom.webhookUrl,
        config.wecom.webhookName || "工单提醒群",
        content,
        event.meta.mentionedMobileList
      );
      appendJsonl(appConfig.alertLedgerPath, { at: event.at, sourceId: event.sourceId, type: event.type, content });
      sent.push({ event, content, ok: true });
    } catch (error) {
      log("巡检", event.sourceId, "提醒发送最终失败", error.message);
      sent.push({ event, content, ok: false, error: error.message });
      // 发送失败的源回滚到本轮前状态，下轮计数仍高于旧基线会重新触发，提醒不丢。
      failedSourceIds.add(event.sourceId);
    }
  }

  if (!options.dryRun) {
    for (const id of failedSourceIds) {
      if (prevSnapshot.sources[id]) {
        state.sources[id] = prevSnapshot.sources[id];
      } else {
        delete state.sources[id];
      }
    }
    saveMonitorState(state);
  }

  return { events, sent, observations };
}

function startMonitorLoop(onRoundDone) {
  const config = loadConfig();
  const intervalMs = (Number(config.monitor.intervalMinutes) || 5) * 60000;
  let running = true;
  log("监控", "常驻", "启动", `间隔=${config.monitor.intervalMinutes}分钟`);

  const runOnceSafely = async () => {
    if (!running) return;
    try {
      const result = await monitorOnce();
      if (onRoundDone) onRoundDone(null, result);
    } catch (error) {
      log("监控", "常驻", "本轮异常", error.message);
      if (onRoundDone) onRoundDone(error);
    }
  };

  runOnceSafely();
  const timer = setInterval(runOnceSafely, intervalMs);
  return {
    stop() {
      running = false;
      clearInterval(timer);
      log("监控", "常驻", "已停止");
    }
  };
}

module.exports = { monitorOnce, startMonitorLoop, loadMonitorState, saveMonitorState, sourceIdOf };
