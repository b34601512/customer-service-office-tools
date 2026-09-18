// 本文件是工单监控业务总入口（真源）：巡检一轮 = 探测各店 → 判定事件 → 发企微 → 落状态。
// TUI/命令行/AI 全部调用这里的同一组函数，界面零业务（#624 边界）。

const appConfig = require("../../config/appConfig");
const { loadConfig, iterateEnabledSources } = require("../../config/projectConfigService");
const { readJson, writeJsonAtomic, appendJsonl } = require("../../engine/fileSystem");
const { log } = require("../../engine/logger");
const { sendWecomText } = require("../../integrations/wecomRobot");
const { probeStore } = require("./pageProbe");
const { createStoreBrowserPool } = require("../../engine/storeBrowserPool");
const { evaluateRound, STATUS } = require("./alertPolicy");
const { buildAlertMessages } = require("./messageText");
const { resolveDuty, buildMentionPlan } = require("../dutySchedule/dutyService");

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

// 执行一轮完整巡检：判定 → 有人值班就 @ 上 → 发企微 → 发成功才推进基线。
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
        // 常驻模式：先用/拉起本店窗口（一个店一个窗口，窗口不关），再把同一个窗口交给探测复用。
        const session = options.sessionPool ? await options.sessionPool.ensure(platformKey, store) : null;
        results = await probeStoreImpl(platformKey, store, timeoutMs, session ? { session } : {});
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
            sourceType: source.type,
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
    merchantPendingRepeatMinutes: config.monitor.merchantPendingRepeatMinutes,
    alertOnFirstRun: config.monitor.alertOnFirstRun !== false
  }, new Date());
  // 注意：这里不立即落盘。要等发送结果确定后再写，避免"发送失败却把基线推进"导致漏提醒。

  const failedSourceIds = new Set();
  const sent = [];
  // 值班@计划：本轮只解析一次（内部按天缓存金山排班）。
  let mentionPlan = null;
  if (events.length > 0 && config.duty) {
    const dutyResult = await (options.resolveDutyImpl || resolveDuty)(config, new Date());
    mentionPlan = (options.buildMentionPlanImpl || buildMentionPlan)(config, dutyResult);
  }
  for (const event of events) {
    // 一单一消息：事件可能展开成多条，逐条发送。
    const messages = buildAlertMessages(event, mentionPlan);
    const mentions = Array.from(new Set([...(event.meta.mentionedMobileList || []), ...(mentionPlan ? mentionPlan.mobiles : [])]));
    try {
      for (const content of messages) {
        await sendTextImpl(config.wecom.webhookUrl, config.wecom.webhookName || "工单提醒群", content, mentions);
        appendJsonl(appConfig.alertLedgerPath, { at: event.at, sourceId: event.sourceId, type: event.type, content });
      }
      sent.push({ event, messages, ok: true });
    } catch (error) {
      log("巡检", event.sourceId, "提醒发送最终失败", error.message);
      sent.push({ event, messages, ok: false, error: error.message });
      // 发送失败的源回滚到本轮前状态，下轮计数仍高于旧基线会重新触发，提醒不丢。
      failedSourceIds.add(event.sourceId);
    }
  }

  // 发送失败的源回滚到本轮前状态（本轮不推进它的基线）；下轮计数仍高于旧基线会重新触发，提醒不丢。
  for (const id of failedSourceIds) {
    if (prevSnapshot.sources[id]) {
      state.sources[id] = prevSnapshot.sources[id];
    } else {
      delete state.sources[id];
    }
  }
  saveMonitorState(state);

  return { events, sent, observations };
}

// 常驻监控：先用/拉起各店窗口，然后每轮跑一次完整巡检（发现新工单就发提醒）。
// 调度：**上一轮抓到新数据后再排下一轮**（不是 setInterval），这样界面上的"新鲜度血条"流干＝该抓下一轮，语义对得上。
// options.keepBrowsersOpen（默认 true）：店铺窗口留着不关，每轮复用；stop() 只停程序、不关窗口。
// options.monitorOnceImpl / options.sessionPool：依赖注入点，测试用假实现跑同一条链路。
// 返回 { stop(), getStatus() }：getStatus 供界面显示（运行中/本轮是否在抓/上次抓到时间/下一轮时刻/本轮摘要/错误）。
function startMonitorLoop(onRoundDone, options = {}) {
  const config = loadConfig();
  const intervalMs = (Number(config.monitor.intervalMinutes) || 10) * 60000;
  const keepBrowsersOpen = options.keepBrowsersOpen !== false;
  const monitorOnceImpl = options.monitorOnceImpl || monitorOnce;
  const pool = options.sessionPool || (keepBrowsersOpen ? createStoreBrowserPool(options.poolOptions) : null);
  let running = true;
  let timer = null;
  const 状态 = {
    running: true,
    intervalMs,
    startedAt: Date.now(),
    warmupDone: false,
    roundInProgress: false,
    lastRoundAt: null,
    lastRoundMs: null,
    lastError: null,
    lastSummary: null,
    nextRoundAt: null
  };
  log("监控", "常驻", "启动", `间隔=${Math.round(intervalMs / 60000)}分钟 窗口保持=${keepBrowsersOpen}`);

  // 本轮抓到什么：界面只用这几个数（详细计数在状态文件里）。
  const 小结本轮 = (result) => {
    const observations = (result && result.observations) || {};
    const 源 = Object.keys(observations);
    const 店铺 = new Set(源.map((id) => id.split("/").slice(0, 2).join("/")));
    return {
      storeCount: 店铺.size,
      sourceCount: 源.length,
      eventCount: ((result && result.events) || []).length,
      sentOkCount: ((result && result.sent) || []).filter((item) => item.ok).length
    };
  };

  // 预热：先把每个店铺的窗口拉起来（人也能看到页面），之后每轮复用同一个窗口。
  const warmupBrowsers = async () => {
    if (!pool) return;
    const seen = new Set();
    for (const item of iterateEnabledSources(config)) {
      const key = `${item.platformKey}/${item.store.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await pool.ensure(item.platformKey, item.store);
      } catch (error) {
        log("监控", "常驻", "窗口预热失败", `${item.store.displayName}：${error.message}`);
      }
    }
  };

  // 下一轮排在上次"抓到新数据"之后量：血条流干的那一刻正好是下一轮开始。
  const 排下一轮 = () => {
    if (!running) return;
    const 基准 = 状态.lastRoundAt || Date.now();
    状态.nextRoundAt = 基准 + intervalMs;
    timer = setTimeout(runOnceSafely, Math.max(0, 状态.nextRoundAt - Date.now()));
  };

  const runOnceSafely = async () => {
    if (!running) return;
    timer = null;
    状态.roundInProgress = true;
    try {
      const result = await monitorOnceImpl({ sessionPool: pool });
      状态.lastRoundAt = Date.now();
      状态.lastError = null;
      状态.lastSummary = 小结本轮(result);
      if (onRoundDone) onRoundDone(null, result);
    } catch (error) {
      状态.lastError = error.message;
      log("监控", "常驻", "本轮异常", error.message);
      if (onRoundDone) onRoundDone(error);
    } finally {
      状态.roundInProgress = false;
      排下一轮();
    }
  };

  // 先预热窗口再跑第一轮：不然第一轮的窗口是探测过程里临时开的。
  warmupBrowsers()
    .catch((error) => log("监控", "常驻", "窗口预热异常", error.message))
    .then(() => {
      状态.warmupDone = true;
      runOnceSafely();
    });

  return {
    stop() {
      running = false;
      状态.running = false;
      状态.nextRoundAt = null;
      if (timer) clearTimeout(timer);
      timer = null;
      if (pool) pool.detachAll();
      log("监控", "常驻", "已停止", keepBrowsersOpen ? "浏览器窗口保持打开" : "浏览器窗口已释放");
    },
    getStatus() {
      return { ...状态 };
    }
  };
}

module.exports = { monitorOnce, startMonitorLoop, loadMonitorState, saveMonitorState, sourceIdOf };
