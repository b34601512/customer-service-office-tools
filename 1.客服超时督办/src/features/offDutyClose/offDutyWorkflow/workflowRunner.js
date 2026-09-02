// 该文件用于调度下班监控主循环。
const { loadReplyConfig } = require("../../../config/replyConfigLoader");
const { log, logError } = require("../../../engine/logger");
const { resolveOffDutyScanDates } = require("../offDutyRunWindow");
const {
  buildOffDutyCandidate,
  buildTodayShiftMapForPolicy,
  listScheduledOffDutyStaffNames
} = require("../offDutyPolicy");
const { createDailyScheduleService } = require("../../scheduleQuery/dailyScheduleService");
const { createOffDutyStateStore } = require("../offDutyStateStore");
const {
  ensureMemberSettingsView,
  readMemberRow
} = require("../memberSettingsPage");
const { closeOffDutyPage } = require("./pageLifecycle");
const { processCandidate } = require("./candidateProcessor");
const { waitForStopOrTimeout } = require("./stopWait");

async function scanOffDutyDate({
  page,
  scheduleService,
  stateStore,
  scheduleDate,
  now,
  config,
  excludedStaffNames = new Set()
}) {
  // 这里按指定排班日期读取早晚班；补检查昨天时，会排除今天仍在上班的客服。
  const scheduleBundle = await scheduleService.readShiftMapsForDate(scheduleDate);
  const allScheduledNames = listScheduledOffDutyStaffNames(scheduleBundle.today.shiftMap);
  const scheduledNames = listScheduledOffDutyStaffNames(
    scheduleBundle.today.shiftMap,
    excludedStaffNames
  );
  const rowMap = {};
  if (scheduledNames.length < allScheduledNames.length) {
    log(
      "主线:等待",
      "下班监控",
      "保护今日客服",
      `昨天补检查跳过今天仍在上班的客服=${allScheduledNames.length - scheduledNames.length}人`
    );
  }

  for (const staffName of scheduledNames) {
    try {
      rowMap[staffName] = await readMemberRow(page, staffName);
    } catch (error) {
      logError("主线:失败", "下班监控", "读取成员状态", error);
    }
  }

  const todayShiftMap = buildTodayShiftMapForPolicy(scheduleBundle.today.shiftMap, rowMap);
  const candidates = Object.values(rowMap)
    .map((row) =>
      buildOffDutyCandidate({
        now,
        shiftDate: scheduleDate,
        config,
        row,
        todayShiftMap,
        tomorrowShiftMap: scheduleBundle.tomorrow.shiftMap
      })
    )
    .filter(Boolean)
    .sort((left, right) => left.closeAt.getTime() - right.closeAt.getTime());

  for (const candidate of candidates) {
    try {
      await processCandidate(page, candidate, config, stateStore);
    } catch (error) {
      logError("主线:失败", "下班监控", "处理单个客服", error);
    }
  }

  return {
    scheduledNames: allScheduledNames
  };
}

async function monitorOffDutyWorkflow(createOffDutyPage, stopState) {
  // 这里启动后立即检查一次，之后按配置间隔持续检查，不再受关闭时间后 30 分钟窗口限制。
  const scheduleService = createDailyScheduleService({ logModuleName: "下班排班" });
  const stateStore = createOffDutyStateStore();
  let activePage = null;

  while (!stopState.stopped) {
    try {
      const config = loadReplyConfig();
      if (!config.offDutyAutomationEnabled) {
        activePage = await closeOffDutyPage(activePage, "下班监控已关闭，交接页已释放");
        await waitForStopOrTimeout(stopState, Math.min(config.offDutyScanIntervalMs, 5000), 1000);
        continue;
      }

      const now = new Date();
      const scanDates = resolveOffDutyScanDates(now);
      if (!activePage) {
        log(
          "主线:执行",
          "下班监控",
          "启动交接页",
          "下班状态检查已启动，首次检查现在执行，之后按配置间隔重复"
        );
        activePage = await createOffDutyPage();
      }

      await ensureMemberSettingsView(activePage);
      log(
        "主线:执行",
        "下班监控",
        "扫描下班状态",
        `本轮检查排班日期=${scanDates.map((date) => date.toLocaleDateString()).join("、")}`
      );

      const todayScheduleDate = scanDates[scanDates.length - 1];
      let todayScanResult = null;
      try {
        // 先扫描今天，拿到保护名单后，昨天的补检查才允许继续。
        todayScanResult = await scanOffDutyDate({
          page: activePage,
          scheduleService,
          stateStore,
          scheduleDate: todayScheduleDate,
          now,
          config
        });
      } catch (error) {
        logError("主线:失败", "下班监控", "读取今天排班", error);
      }

      if (todayScanResult) {
        for (const scheduleDate of scanDates.slice(0, -1)) {
          try {
            await scanOffDutyDate({
              page: activePage,
              scheduleService,
              stateStore,
              scheduleDate,
              now,
              config,
              excludedStaffNames: new Set(todayScanResult.scheduledNames)
            });
          } catch (error) {
            logError("主线:失败", "下班监控", "读取昨天补检查排班", error);
          }
        }
      } else {
        log(
          "主线:等待",
          "下班监控",
          "跳过昨天补检查",
          "今天排班读取失败，为避免误关今天客服，本轮不执行昨天漏关补处理"
        );
      }

      await waitForStopOrTimeout(stopState, config.offDutyScanIntervalMs, 5000);
    } catch (error) {
      activePage = await closeOffDutyPage(activePage);
      logError("主线:失败", "下班监控", "轮询失败", error);
      await waitForStopOrTimeout(stopState, 5000, 1000);
    }
  }

  activePage = await closeOffDutyPage(activePage);
  log("主线:停止", "下班监控", "结束轮询", "收到停止信号，下班监控轮询结束");
}

module.exports = {
  monitorOffDutyWorkflow,
  scanOffDutyDate
};
