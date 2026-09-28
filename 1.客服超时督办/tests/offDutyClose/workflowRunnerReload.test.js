const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// 本文件锁定：下班监控每轮扫描前必须强制刷新成员设置页，禁止读页面缓存旧状态。
// 现场 2026-09-28 16:00：成员页未刷新时读到的开关状态与 19 秒后的新读不一致。
function resolveSrc(relativePath) {
  return require.resolve(path.resolve(__dirname, "../../src", relativePath));
}

function installMock(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

const sequence = [];
const reloadCalls = [];

installMock(resolveSrc("config/replyConfigLoader.js"), {
  loadReplyConfig: () => ({ offDutyAutomationEnabled: true, offDutyScanIntervalMs: 1000 })
});
installMock(resolveSrc("engine/logger.js"), {
  log() {},
  logError() {}
});
installMock(resolveSrc("features/offDutyClose/offDutyConfig.js"), {
  resolveNextOffDutyBoundaryDelayMs: () => 1000
});
installMock(resolveSrc("features/offDutyClose/offDutyRunWindow.js"), {
  resolveOffDutyScanDates: () => [new Date(2026, 8, 28, 16, 0, 0)]
});
installMock(resolveSrc("features/offDutyClose/offDutyPolicy.js"), {
  buildOffDutyCandidate: () => null,
  buildTodayShiftMapForPolicy: () => ({}),
  listScheduledOffDutyStaffNames: () => ["张三"]
});
installMock(resolveSrc("features/scheduleQuery/dailyScheduleService.js"), {
  createDailyScheduleService: () => ({
    readShiftMapsForDate: async () => ({ today: { shiftMap: {} }, tomorrow: { shiftMap: {} } })
  })
});
installMock(resolveSrc("features/offDutyClose/offDutyStateStore.js"), {
  createOffDutyStateStore: () => ({})
});
installMock(resolveSrc("features/offDutyClose/memberSettingsPage.js"), {
  async reloadMemberSettingsView(page, windowLabel) {
    sequence.push("reload");
    reloadCalls.push({ page, windowLabel });
  },
  async readMemberRow() {
    sequence.push("read");
    return {};
  }
});
installMock(resolveSrc("features/offDutyClose/offDutyWorkflow/pageLifecycle.js"), {
  closeOffDutyPage: async (page) => page
});
installMock(resolveSrc("features/offDutyClose/offDutyWorkflow/candidateProcessor.js"), {
  processCandidate: async () => {}
});
installMock(resolveSrc("features/offDutyClose/offDutyWorkflow/stopWait.js"), {
  waitForStopOrTimeout: async (stopState) => {
    stopState.stopped = true;
  }
});
installMock(resolveSrc("features/loginFlow.js"), {
  isLoginRequiredError: () => false
});

const workflowRunnerPath = resolveSrc("features/offDutyClose/offDutyWorkflow/workflowRunner.js");
delete require.cache[workflowRunnerPath];
const { monitorOffDutyWorkflow } = require(workflowRunnerPath);

test("下班监控每轮扫描前必须刷新成员设置页，且先刷新后读成员状态", async () => {
  const stopState = { stopped: false };
  const fakePage = { id: "off-duty-page" };

  await monitorOffDutyWorkflow(async () => fakePage, stopState);

  assert.equal(reloadCalls.length, 1);
  assert.equal(reloadCalls[0].page, fakePage);
  assert.equal(reloadCalls[0].windowLabel, "下班监控");
  assert.deepEqual(sequence, ["reload", "read"]);
});
