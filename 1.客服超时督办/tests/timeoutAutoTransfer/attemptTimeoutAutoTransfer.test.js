const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const appConfig = require("../../src/config/appConfig");
const { setupIsolatedWecomTestConfig } = require("../support/wecomTestConfig");
const {
  attemptTimeoutAutoTransfer
} = require("../../src/features/missedReplyMonitor/missedReplyWorkflow/reminderProcessor");
const { ASSIGNMENT_STATUS } = require("../../src/features/shared/currentAssignment");
const {
  publishOnlinePresenceSnapshot,
  resetOnlinePresenceSnapshot
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceSnapshotStore");
const {
  listPendingTransferVerifications,
  resetPendingTransferVerifications
} = require("../../src/features/transferMonitor/autoTransferVerificationStore");

const WECOM_CONFIG_PATH = setupIsolatedWecomTestConfig("attempt-timeout-auto-transfer");

const config = {
  timeoutAutoTransferEnabled: true,
  onlinePresenceWorkStartTime: "08:00",
  offDutyPreSalesEarlyCloseTime: "16:30",
  offDutyPreSalesLateCloseTime: "23:45",
  offDutyAfterSalesEarlyCloseTime: "16:30",
  offDutyAfterSalesLateCloseTime: "22:30"
};

const memberMapByUserId = {
  "operation-1": { userId: "operation-1", staffName: "运营", staffGroup: "operation" },
  "pre-ye": { userId: "pre-ye", staffName: "叶炳辉", staffGroup: "pre_sales" }
};

const assignment = {
  assignedToUserId: "operation-1",
  status: ASSIGNMENT_STATUS.ASSIGNED,
  assigneeMember: { userId: "operation-1", staffName: "运营", staffGroup: "operation" }
};

function buildScheduleData() {
  return {
    backgroundColorAvailable: true,
    shiftMap: {
      叶炳辉: { normalizedShift: "早班", hasBackgroundColor: true, backgroundColor: "#E2F0D9" }
    }
  };
}

function buildPageWithSocket(records) {
  return {
    async evaluate(pageFunction, argument) {
      const originalWindow = global.window;
      global.window = { __customerServiceAppSockets: records };
      try {
        return pageFunction(argument);
      } finally {
        global.window = originalWindow;
      }
    }
  };
}

function buildSentFrameRecorder() {
  const frames = [];
  return {
    frames,
    record: {
      url: "wss://zan-mh.xiaoshunai.com/socket.io/?token=secret",
      outboundFrames: ["0{\"sid\":\"x\"}", "40"],
      lastInboundFrame: "",
      socket: {
        readyState: 1,
        send(frame) {
          frames.push(frame);
        }
      }
    }
  };
}

test.beforeEach(() => {
  resetOnlinePresenceSnapshot();
  resetPendingTransferVerifications();
  fs.writeFileSync(WECOM_CONFIG_PATH, JSON.stringify({
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
  }));
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { errcode: 0, errmsg: "ok" };
    }
  });
});

test.after(() => {
  fs.rmSync(WECOM_CONFIG_PATH, { force: true });
});

test("运营超时应该通过页面 socket 发出 assignChat 事件并登记待核验", async () => {
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      叶炳辉: { staffName: "叶炳辉", staffGroup: "pre_sales", transferEnabled: true }
    }
  });
  const recorder = buildSentFrameRecorder();
  const page = buildPageWithSocket([recorder.record]);

  const result = await attemptTimeoutAutoTransfer({
    page,
    scheduleService: { readDailyShiftMap: async () => buildScheduleData() },
    candidate: { chatId: "chat-1", reminderKind: "timeout", customerName: "客户甲" },
    assignment,
    memberMapByUserId,
    replyConfig: config,
    now: new Date(2026, 8, 16, 10, 0)
  });

  assert.equal(result.status, "sent");
  assert.equal(recorder.frames.length, 1);
  assert.equal(recorder.frames[0], "42[\"assignChat\",{\"chatId\":\"chat-1\",\"groupId\":\"group\",\"assigneeId\":\"pre-ye\"}]");

  const pendingList = listPendingTransferVerifications();
  assert.equal(pendingList.length, 1);
  assert.equal(pendingList[0].targetStaffName, "叶炳辉");
  assert.equal(pendingList[0].sourceStaffName, "运营");
});

test("当班客服不在线时不发转接指令，但必须@主管", async () => {
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      叶炳辉: { staffName: "叶炳辉", staffGroup: "pre_sales", transferEnabled: false }
    }
  });
  const recorder = buildSentFrameRecorder();
  const page = buildPageWithSocket([recorder.record]);
  const sentBodies = [];
  global.fetch = async (url, options) => {
    sentBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      async json() {
        return { errcode: 0, errmsg: "ok" };
      }
    };
  };

  const result = await attemptTimeoutAutoTransfer({
    page,
    scheduleService: { readDailyShiftMap: async () => buildScheduleData() },
    candidate: { chatId: "chat-2", reminderKind: "timeout", customerName: "客户乙" },
    assignment,
    memberMapByUserId,
    replyConfig: config,
    now: new Date(2026, 8, 16, 10, 0)
  });

  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "duty_member_offline");
  assert.equal(recorder.frames.length, 0);
  assert.equal(listPendingTransferVerifications().length, 0);
  assert.equal(sentBodies.length, 1);
  assert.deepEqual(sentBodies[0].text.mentioned_mobile_list, ["19900000000"]);
  assert.match(sentBodies[0].text.content, /超时自动转接失败/);
});

test("页面没有可用 socket 时按失败处理并通知主管", async () => {
  publishOnlinePresenceSnapshot({
    rowsByStaffName: {
      叶炳辉: { staffName: "叶炳辉", staffGroup: "pre_sales", transferEnabled: true }
    }
  });
  const page = buildPageWithSocket([
    {
      url: "wss://zan-mh.xiaoshunai.com/socket.io/?token=secret",
      outboundFrames: [],
      lastInboundFrame: "",
      socket: { readyState: 3, send() {} }
    }
  ]);
  const sentBodies = [];
  global.fetch = async (url, options) => {
    sentBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      async json() {
        return { errcode: 0, errmsg: "ok" };
      }
    };
  };

  const result = await attemptTimeoutAutoTransfer({
    page,
    scheduleService: { readDailyShiftMap: async () => buildScheduleData() },
    candidate: { chatId: "chat-3", reminderKind: "timeout", customerName: "客户丙" },
    assignment,
    memberMapByUserId,
    replyConfig: config,
    now: new Date(2026, 8, 16, 10, 0)
  });

  assert.equal(result.status, "failed");
  assert.equal(result.reason, "no_open_app_socket");
  assert.equal(listPendingTransferVerifications().length, 0);
  assert.equal(sentBodies.length, 1);
  assert.match(sentBodies[0].text.content, /页面没有可用的 socket 连接/);
});

test("自动转接开关关闭时不应该读排班也不发通知", async () => {
  const recorder = buildSentFrameRecorder();
  let scheduleReadCount = 0;
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
  };

  const result = await attemptTimeoutAutoTransfer({
    page: buildPageWithSocket([recorder.record]),
    scheduleService: {
      readDailyShiftMap: async () => {
        scheduleReadCount += 1;
        return buildScheduleData();
      }
    },
    candidate: { chatId: "chat-4", reminderKind: "timeout", customerName: "客户丁" },
    assignment,
    memberMapByUserId,
    replyConfig: { ...config, timeoutAutoTransferEnabled: false },
    now: new Date(2026, 8, 16, 10, 0)
  });

  assert.equal(result.status, "disabled");
  assert.equal(scheduleReadCount, 0);
  assert.equal(fetchCount, 0);
});
