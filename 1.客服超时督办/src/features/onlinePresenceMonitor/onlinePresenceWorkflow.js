const { loadReplyConfig } = require("../../config/replyConfigLoader");
const { log, logError } = require("../../engine/logger");
const { readMemberRow, reloadMemberSettingsView } = require("../offDutyClose/memberSettingsPage");
const { setMemberAutoAssign, setMemberTransferEnabled } = require("../offDutyClose/memberSettingsPage/memberSwitch");
const { parseStaffRoleGroup } = require("../shared/staffIdentity");
const { createDailyScheduleService } = require("../scheduleQuery/dailyScheduleService");
const {
  createOnlinePresenceStateStore
} = require("./onlinePresenceStateStore");
const {
  summarizeOnlinePresenceStatus
} = require("./onlinePresencePolicy");
const { sendOnlinePresenceReminder } = require("./onlinePresenceNotifier");

const ONLINE_PRESENCE_LOG_MODULE_NAME = "上班监控";

function listScheduledCustomerServiceNames(shiftMap) {
  // 这里先按排班粗筛早晚班人员，具体是否当前应值班交给策略层结合成员角色判断。
  return Object.entries(shiftMap || {})
    .filter(([, shiftInfo]) => ["早班", "晚班"].includes(shiftInfo.normalizedShift))
    .map(([staffName]) => staffName);
}

function listRestingStaffNames(shiftMap) {
  // 这里把非早晚班人员一律视为休息（空白/年假/请假/行政等），
  // 休息的人不接单，若还开着自动分配或可被转接需要自动关闭，避免客户被转接后无人回复。
  return Object.entries(shiftMap || {})
    .filter(([, shiftInfo]) => !["早班", "晚班"].includes(shiftInfo.normalizedShift))
    .map(([staffName]) => staffName);
}

async function readScheduledMemberRows(page, scheduledStaffNames) {
  // 这里读取排班相关成员状态，缺任何一人都让上层本轮不贸然提醒。
  const rowMap = {};
  const readFailedStaffNames = [];

  for (const staffName of scheduledStaffNames) {
    try {
      rowMap[staffName] = await readMemberRow(page, staffName);
    } catch (error) {
      readFailedStaffNames.push(staffName);
      logError("主线:失败", ONLINE_PRESENCE_LOG_MODULE_NAME, "读取成员状态", error);
    }
  }

  return {
    rowMap,
    readFailedStaffNames
  };
}

function buildScanPayload(summary) {
  // 这里把扫描结果压成状态文件可读的最小结构，方便现场核对系统看到什么。
  return {
    expectedStaffNames: summary.expectedStaffNames,
    onlineStaffNames: summary.onlineStaffNames,
    offlineStaffNames: summary.offlineStaffNames,
    missingStaffNames: summary.missingStaffNames,
    readFailedStaffNames: summary.readFailedStaffNames,
    canDecide: summary.canDecide,
    shouldNotify: summary.shouldNotify,
    absenceKey: summary.absenceKey
  };
}

function logOnlinePresenceSummary(runtimeState, summary) {
  // 这里只在摘要变化时打印一次，避免 5 秒扫描把日志刷屏。
  const summaryKey = [
    summary.expectedStaffNames.join("/"),
    summary.onlineStaffNames.join("/"),
    summary.offlineStaffNames.join("/"),
    summary.missingStaffNames.join("/"),
    summary.readFailedStaffNames.join("/"),
    summary.shouldNotify ? "notify" : "normal"
  ].join("|");
  if (runtimeState.lastSummaryKey === summaryKey) {
    return;
  }
  runtimeState.lastSummaryKey = summaryKey;

  log(
    "主线:执行",
    ONLINE_PRESENCE_LOG_MODULE_NAME,
    "刷新在线状态",
    `应值班=${summary.expectedStaffNames.length}，在线=${summary.onlineStaffNames.join(" / ") || "无"}，离线=${summary.offlineStaffNames.join(" / ") || "无"}`
  );
}

async function handleOnlinePresenceSummary(stateStore, summary) {
  // 这里根据当前真实状态决定是否提醒：有人在线就恢复，无人在线且新一段缺席才提醒。
  stateStore.saveLatestScan(buildScanPayload(summary));

  if (!summary.hasExpectedStaff) {
    stateStore.markPresenceRestored({
      status: "no_expected_staff"
    });
    return;
  }

  if (!summary.canDecide) {
    log(
      "主线:执行",
      ONLINE_PRESENCE_LOG_MODULE_NAME,
      "跳过提醒",
      `状态不完整，缺少=${summary.missingStaffNames.join(" / ") || "无"}，读取失败=${summary.readFailedStaffNames.join(" / ") || "无"}`
    );
    return;
  }

  if (summary.onlineStaffNames.length > 0) {
    if (stateStore.markPresenceRestored({
      status: "online",
      onlineStaffNames: summary.onlineStaffNames
    })) {
      log(
        "主线:完成",
        ONLINE_PRESENCE_LOG_MODULE_NAME,
        "恢复在线",
        `在线客服=${summary.onlineStaffNames.join(" / ")}`
      );
    }
    return;
  }

  if (!stateStore.shouldSendAbsenceReminder(summary.absenceKey)) {
    return;
  }

  const notificationResult = await sendOnlinePresenceReminder({
    expectedStaffNames: summary.expectedStaffNames
  });
  stateStore.markAbsenceReminderSent(summary.absenceKey, {
    status: "reminded",
    expectedStaffNames: summary.expectedStaffNames,
    targetStaffNames: notificationResult.targetStaffNames,
    escalationWebhookName: notificationResult.webhookName
  });
  log(
    "主线:完成",
    ONLINE_PRESENCE_LOG_MODULE_NAME,
    "发送提醒",
    `应值班客服=${summary.expectedStaffNames.join(" / ")}，已提醒=${notificationResult.targetStaffNames.join(" / ")}`
  );
}

function listTransferAutoOpenCandidates(rowMap, config) {
  // 这里找出“自动分配已开但可被转接待没开”的应值班客服，供自动补开使用。
  if (!config?.transferAutoOpenEnabled) {
    return [];
  }

  return Object.entries(rowMap || {})
    .filter(([, row]) => row?.autoAssignEnabled === true && row?.transferEnabled === false)
    .map(([staffName]) => staffName);
}

function listTransferAutoCloseCandidates(rowMap, config) {
  // 这里找出“自动分配已关但可被转接待仍开”的应值班售后客服，供自动关闭使用，
  // 避免同事把自动分配关掉后还被人转接待，造成客户无人回复。
  // 只对售后生效：售前常年不开自动分配，且售前在线看的就是「可被转接」，
  // 若对售前也自动关闭，会把被叫上线的售前误判成离线。
  if (!config?.transferAutoCloseEnabled) {
    return [];
  }

  return Object.entries(rowMap || {})
    .filter(([, row]) => {
      const staffGroup = row?.staffGroup || parseStaffRoleGroup(row?.roleLabel);
      return staffGroup === "after_sales" && row?.autoAssignEnabled === false && row?.transferEnabled === true;
    })
    .map(([staffName]) => staffName);
}

async function autoOpenTransferEnabled(page, rowMap, config) {
  // 这里自动帮客服打开“是否可被转接”：客服常常忘记开，导致别人无法转接待给他。
  const candidates = listTransferAutoOpenCandidates(rowMap, config);
  for (const staffName of candidates) {
    try {
      const changed = await setMemberTransferEnabled(page, staffName, true);
      if (changed) {
        log(
          "主线:完成",
          ONLINE_PRESENCE_LOG_MODULE_NAME,
          "自动打开转接待",
          `客服=${staffName}，检测到自动分配开启但可被转接待关闭，已自动开启「是否可被转接」`
        );
        rowMap[staffName].transferEnabled = true;
      }
    } catch (error) {
      logError("主线:失败", ONLINE_PRESENCE_LOG_MODULE_NAME, "自动打开转接待", error);
    }
  }
}

async function autoCloseTransferEnabled(page, rowMap, config) {
  // 这里自动帮客服关闭“是否可被转接”：客服关了自动分配但漏关可被转接时，
  // 别人仍能转接待给他，容易造成客户无人回复。
  const candidates = listTransferAutoCloseCandidates(rowMap, config);
  for (const staffName of candidates) {
    try {
      const changed = await setMemberTransferEnabled(page, staffName, false);
      if (changed) {
        log(
          "主线:完成",
          ONLINE_PRESENCE_LOG_MODULE_NAME,
          "自动关闭转接待",
          `客服=${staffName}，检测到自动分配已关闭但可被转接待仍开启，已自动关闭「是否可被转接」`
        );
        rowMap[staffName].transferEnabled = false;
      }
    } catch (error) {
      logError("主线:失败", ONLINE_PRESENCE_LOG_MODULE_NAME, "自动关闭转接待", error);
    }
  }
}

async function autoCloseRestingStaffSwitches(page, restingRowMap) {
  // 这里自动关闭休息人员的接单开关：休息/年假/请假的人不接单，
  // 若自动分配或可被转接还开着，客户会被转接或分流过来却无人回复，必须两个都关。
  for (const [staffName, row] of Object.entries(restingRowMap || {})) {
    try {
      if (row?.autoAssignEnabled === true) {
        const changed = await setMemberAutoAssign(page, staffName, false);
        if (changed) {
          log(
            "主线:完成",
            ONLINE_PRESENCE_LOG_MODULE_NAME,
            "休息人员关闭自动分配",
            `客服=${staffName}，今天休息但自动分配仍开启，已自动关闭`
          );
          row.autoAssignEnabled = false;
        }
      }
      if (row?.transferEnabled === true) {
        const changed = await setMemberTransferEnabled(page, staffName, false);
        if (changed) {
          log(
            "主线:完成",
            ONLINE_PRESENCE_LOG_MODULE_NAME,
            "休息人员关闭转接待",
            `客服=${staffName}，今天休息但可被转接仍开启，已自动关闭`
          );
          row.transferEnabled = false;
        }
      }
    } catch (error) {
      logError("主线:失败", ONLINE_PRESENCE_LOG_MODULE_NAME, "休息人员关闭开关", error);
    }
  }
}

async function runOnlinePresenceScan(page, scheduleService, stateStore, runtimeState) {
  // 这里执行单轮无人在线扫描：读取排班、读取成员开关、自动补开转接待、按规则决定是否提醒。
  const config = loadReplyConfig();
  if (!config.onlinePresenceMonitorEnabled) {
    if (!runtimeState.disabledLogged) {
      runtimeState.disabledLogged = true;
      log("主线:停止", ONLINE_PRESENCE_LOG_MODULE_NAME, "配置停用", "上班监控已在配置中关闭");
    }
    return;
  }
  runtimeState.disabledLogged = false;

  // 强制刷新成员设置页，避免读到其他电脑改开关前的缓存旧状态。
  await reloadMemberSettingsView(page);
  const now = new Date();
  const scheduleBundle = await scheduleService.readShiftMapsForDate(now);
  const scheduledStaffNames = listScheduledCustomerServiceNames(scheduleBundle.today.shiftMap);
  const memberRows = await readScheduledMemberRows(page, scheduledStaffNames);
  await autoOpenTransferEnabled(page, memberRows.rowMap, config);
  await autoCloseTransferEnabled(page, memberRows.rowMap, config);

  // 休息人员（非早晚班）不参与在线提醒，但若还开着接单开关需要自动关闭；
  // 单独读取单独处理，读取失败不污染主 rowMap，避免影响在线提醒判断。
  const restingStaffNames = listRestingStaffNames(scheduleBundle.today.shiftMap);
  if (restingStaffNames.length > 0) {
    const restingRows = await readScheduledMemberRows(page, restingStaffNames);
    await autoCloseRestingStaffSwitches(page, restingRows.rowMap);
  }

  const summary = summarizeOnlinePresenceStatus({
    todayShiftMap: scheduleBundle.today.shiftMap,
    rowMap: memberRows.rowMap,
    readFailedStaffNames: memberRows.readFailedStaffNames,
    config,
    now
  });

  logOnlinePresenceSummary(runtimeState, summary);
  await handleOnlinePresenceSummary(stateStore, summary);
}

async function monitorOnlinePresenceWorkflow(createOnlinePresencePage, stopState) {
  // 这里持续运行独立无人在线监控，和下班监控彻底分开。
  const scheduleService = createDailyScheduleService({ logModuleName: "上班监控排班" });
  const stateStore = createOnlinePresenceStateStore();
  const runtimeState = {
    lastSummaryKey: "",
    disabledLogged: false
  };
  let onlinePresencePage = null;

  try {
    onlinePresencePage = await createOnlinePresencePage();
    while (!stopState.stopped) {
      try {
        await runOnlinePresenceScan(onlinePresencePage, scheduleService, stateStore, runtimeState);
      } catch (error) {
        logError("主线:失败", ONLINE_PRESENCE_LOG_MODULE_NAME, "单轮扫描失败", error);
      }

      const config = loadReplyConfig();
      await onlinePresencePage.waitForTimeout(config.onlinePresenceScanIntervalMs);
    }
  } finally {
    await onlinePresencePage?.close().catch(() => {});
  }

  log("主线:停止", ONLINE_PRESENCE_LOG_MODULE_NAME, "结束轮询", "收到停止信号，上班监控轮询结束");
}

module.exports = {
  ONLINE_PRESENCE_LOG_MODULE_NAME,
  autoCloseRestingStaffSwitches,
  autoCloseTransferEnabled,
  autoOpenTransferEnabled,
  buildScanPayload,
  handleOnlinePresenceSummary,
  listRestingStaffNames,
  listScheduledCustomerServiceNames,
  listTransferAutoCloseCandidates,
  listTransferAutoOpenCandidates,
  monitorOnlinePresenceWorkflow,
  runOnlinePresenceScan
};
