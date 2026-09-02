const test = require("node:test");
const assert = require("node:assert/strict");

test("自动关闭候选应该只挑「自动分配关但转接待开」的售后客服", () => {
  const { listTransferAutoCloseCandidates } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const rowMap = {
    张三: { roleLabel: "售后", autoAssignEnabled: false, transferEnabled: true },
    李四: { roleLabel: "售后", autoAssignEnabled: true, transferEnabled: true },
    王五: { roleLabel: "售后", autoAssignEnabled: false, transferEnabled: false },
    赵六: { roleLabel: "售后", autoAssignEnabled: true, transferEnabled: false }
  };
  assert.deepEqual(listTransferAutoCloseCandidates(rowMap, { transferAutoCloseEnabled: true }), ["张三"]);
});

test("自动关闭候选只应包含售后，售前即使自动分配关且转接待开也不自动关闭", () => {
  const { listTransferAutoCloseCandidates } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const rowMap = {
    易凡: { roleLabel: "售前", autoAssignEnabled: false, transferEnabled: true },
    卢安: { roleLabel: "售后", autoAssignEnabled: false, transferEnabled: true },
    苏哲: { staffGroup: "after_sales", autoAssignEnabled: false, transferEnabled: true }
  };
  assert.deepEqual(listTransferAutoCloseCandidates(rowMap, { transferAutoCloseEnabled: true }), [
    "卢安",
    "苏哲"
  ]);
});

test("配置关闭时不应该产生任何自动关闭候选", () => {
  const { listTransferAutoCloseCandidates } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const rowMap = { 张三: { autoAssignEnabled: false, transferEnabled: true } };
  assert.deepEqual(listTransferAutoCloseCandidates(rowMap, { transferAutoCloseEnabled: false }), []);
  assert.deepEqual(listTransferAutoCloseCandidates(rowMap, {}), []);
});

test("自动关闭动作应该只对仍开着转接待的客服点击，并把状态同步回 rowMap", async () => {
  // 这里通过 require 缓存注入假开关函数，验证自动关闭的调用与状态同步。
  const workflowModulePath = require.resolve("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const memberSwitchModulePath = require.resolve("../../src/features/offDutyClose/memberSettingsPage/memberSwitch");
  const clicked = [];
  require.cache[memberSwitchModulePath] = {
    id: memberSwitchModulePath,
    filename: memberSwitchModulePath,
    loaded: true,
    exports: {
      async setMemberTransferEnabled(page, staffName, enabled) {
        clicked.push(`${staffName}:${enabled}`);
        return true;
      }
    }
  };
  delete require.cache[workflowModulePath];

  const { autoCloseTransferEnabled } = require(workflowModulePath);
  const rowMap = {
    张三: { roleLabel: "售后", autoAssignEnabled: false, transferEnabled: true },
    李四: { roleLabel: "售后", autoAssignEnabled: false, transferEnabled: false }
  };
  await autoCloseTransferEnabled({}, rowMap, { transferAutoCloseEnabled: true });
  assert.deepEqual(clicked, ["张三:false"]);
  assert.equal(rowMap.张三.transferEnabled, false);
  assert.equal(rowMap.李四.transferEnabled, false); // 已关闭的不动
});

test("配置读取应默认开启自动关闭转接待", () => {
  // 无人在线监控配置的默认值应包含自动关闭且默认开启。
  const { loadReplyConfig } = require("../../src/config/replyConfigLoader");
  const config = loadReplyConfig();
  assert.equal(config.transferAutoCloseEnabled, true);
});