const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// 本文件锁定：开关点击后必须复查，没真的变成关闭态就不许发“已完成下班收尾”。
// 现场 2026-09-28 16:00：群里说“是否可被转接【已关闭】”，15 秒后开关又被补开。
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

const loggerErrors = [];
installMock(resolveSrc("engine/logger.js"), {
  log() {},
  logError(mainAction, moduleName, subAction, error) {
    loggerErrors.push({ mainAction, moduleName, subAction, message: String(error?.message || error) });
  }
});

const memberPageState = {
  readRows: [],
  clicks: []
};
installMock(resolveSrc("features/offDutyClose/memberSettingsPage.js"), {
  async readMemberRow() {
    return memberPageState.readRows.shift();
  },
  async setMemberAutoAssign(page, staffName, enabled) {
    memberPageState.clicks.push(`${staffName}:autoAssign:${enabled}`);
    return true;
  },
  async setMemberTransferEnabled(page, staffName, enabled) {
    memberPageState.clicks.push(`${staffName}:transfer:${enabled}`);
    return true;
  }
});

const notifierCalls = [];
installMock(resolveSrc("features/offDutyClose/offDutyWorkflow/completionNotifier.js"), {
  async notifyCompletedClose(candidate, config, actionSummary) {
    notifierCalls.push({ staffName: candidate.staffName, actionSummary });
    return { escalationStatus: "测试", escalationWebhookName: "测试" };
  }
});

const recorderCalls = [];
installMock(resolveSrc("features/offDutyClose/offDutyWorkflow/processRecorder.js"), {
  recordOffDutyProcess(candidate, statusLabel, reason, extra) {
    recorderCalls.push({ statusLabel, reason, extra });
  }
});

const candidateProcessorPath = resolveSrc("features/offDutyClose/offDutyWorkflow/candidateProcessor.js");
delete require.cache[candidateProcessorPath];
const { processCandidate } = require(candidateProcessorPath);

function buildCandidate() {
  return {
    staffName: "邓远祥",
    actionKey: "2026-09-28::邓远祥::早班",
    silentClose: false,
    closeAt: new Date(2026, 8, 28, 16, 0, 0),
    closeTimeText: "16:00",
    shiftLabel: "早班",
    tomorrowShiftLabel: "晚班",
    currentConversationCount: 0,
    roleLabel: "售后"
  };
}

function createStateStore() {
  const calls = {
    markActionCompleted: [],
    markCompletionNoticeSent: []
  };
  return {
    calls,
    store: {
      getActionCompletion: () => null,
      clearActionCompleted: () => {},
      hasCompletionNotice: () => false,
      markCompletionNoticeSent: (key, payload) => calls.markCompletionNoticeSent.push({ key, payload }),
      markActionCompleted: (key, payload) => calls.markActionCompleted.push({ key, payload })
    }
  };
}

function resetObservations() {
  memberPageState.clicks = [];
  notifierCalls.length = 0;
  recorderCalls.length = 0;
  loggerErrors.length = 0;
}

test("点击后开关仍是开启态：不发“已完成”通知、不标记完成，只留失败现场", async () => {
  resetObservations();
  memberPageState.readRows = [
    { currentConversationCount: 0, autoAssignEnabled: true, transferEnabled: true },
    { currentConversationCount: 0, autoAssignEnabled: true, transferEnabled: true },
    { currentConversationCount: 0, autoAssignEnabled: true, transferEnabled: true }
  ];
  const { store, calls } = createStateStore();

  await processCandidate({}, buildCandidate(), {}, store);

  assert.deepEqual(memberPageState.clicks, ["邓远祥:autoAssign:false", "邓远祥:transfer:false"]);
  assert.equal(notifierCalls.length, 0);
  assert.equal(calls.markActionCompleted.length, 0);
  assert.equal(calls.markCompletionNoticeSent.length, 0);
  assert.equal(recorderCalls.length, 1);
  assert.equal(recorderCalls[0].statusLabel, "下班收尾未生效");
  assert.match(recorderCalls[0].reason, /自动分配【仍开启】/);
  assert.match(recorderCalls[0].reason, /是否可被转接【仍开启】/);
  assert.equal(loggerErrors.length, 1);
});

test("复查确认两个开关都已关闭：照常发送“已完成下班收尾”并标记完成", async () => {
  resetObservations();
  memberPageState.readRows = [
    { currentConversationCount: 0, autoAssignEnabled: true, transferEnabled: true },
    { currentConversationCount: 0, autoAssignEnabled: true, transferEnabled: true },
    { currentConversationCount: 0, autoAssignEnabled: false, transferEnabled: false }
  ];
  const { store, calls } = createStateStore();

  await processCandidate({}, buildCandidate(), {}, store);

  assert.equal(notifierCalls.length, 1);
  assert.equal(notifierCalls[0].actionSummary, "当前状态：自动分配【已关闭】；是否可被转接【已关闭】");
  assert.equal(calls.markCompletionNoticeSent.length, 1);
  assert.equal(calls.markActionCompleted.length, 1);
  assert.equal(recorderCalls.length, 1);
  assert.equal(recorderCalls[0].statusLabel, "已自动关闭下班配置");
  assert.equal(loggerErrors.length, 0);
});
