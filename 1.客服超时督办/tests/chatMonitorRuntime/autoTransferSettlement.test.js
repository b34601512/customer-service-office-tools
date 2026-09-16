const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const appConfig = require("../../src/config/appConfig");
const { setupIsolatedWecomTestConfig } = require("../support/wecomTestConfig");
const {
  settlePendingAutoTransfers
} = require("../../src/features/chatMonitorRuntime/workflowRunner");
const {
  recordPendingTransferVerification,
  resetPendingTransferVerifications,
  listPendingTransferVerifications
} = require("../../src/features/transferMonitor/autoTransferVerificationStore");

const WECOM_CONFIG_PATH = setupIsolatedWecomTestConfig("auto-transfer-settlement");

test.beforeEach(() => {
  resetPendingTransferVerifications();
});

test.after(() => {
  fs.rmSync(WECOM_CONFIG_PATH, { force: true });
});

function captureNotices() {
  const sentContents = [];
  global.fetch = async (url, options) => {
    sentContents.push(JSON.parse(options.body).text.content);
    return {
      ok: true,
      status: 200,
      async json() {
        return { errcode: 0, errmsg: "ok" };
      }
    };
  };
  return sentContents;
}

test("联系人快照改口后发送转接成功通知", async () => {
  const sentContents = captureNotices();
  recordPendingTransferVerification({
    chatId: "chat-1",
    customerName: "客户甲",
    sourceStaffName: "刘秀文",
    targetStaffName: "叶炳辉",
    targetUserId: "pre-ye",
    reminderKind: "timeout"
  });

  await settlePendingAutoTransfers([
    { chatId: "chat-1", assignedToUserId: "pre-ye", customerName: "客户甲" }
  ]);

  assert.equal(listPendingTransferVerifications().length, 0);
  assert.equal(sentContents.length, 1);
  assert.match(sentContents[0], /【超时自动转接】客户已改派/);
  assert.match(sentContents[0], /已转给：叶炳辉/);
});

test("超时后仍未改派时发送失败通知并@主管", async () => {
  const sentContents = [];
  global.fetch = async (url, options) => {
    sentContents.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      async json() {
        return { errcode: 0, errmsg: "ok" };
      }
    };
  };
  const entry = recordPendingTransferVerification({
    chatId: "chat-2",
    customerName: "客户乙",
    sourceStaffName: "刘秀文",
    targetStaffName: "叶炳辉",
    targetUserId: "pre-ye",
    reminderKind: "missedReply",
    timeoutMs: 5000
  });

  await settlePendingAutoTransfers(
    [{ chatId: "chat-2", assignedToUserId: "pre-liu", customerName: "客户乙" }],
    { nowMs: entry.recordAtMs + 6000 }
  );

  assert.equal(sentContents.length, 1);
  assert.deepEqual(sentContents[0].text.mentioned_mobile_list, ["19900000000"]);
  assert.match(sentContents[0].text.content, /已发出转接指令，但平台分配结果没有变化/);
  assert.match(sentContents[0].text.content, /触发：漏回复提醒/);
});
