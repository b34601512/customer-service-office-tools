const test = require("node:test");
const assert = require("node:assert/strict");

test("自动补开候选应该只挑「自动分配开但转接待关」的客服", () => {
  const { listTransferAutoOpenCandidates } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const rowMap = {
    张三: { autoAssignEnabled: true, transferEnabled: false },
    李四: { autoAssignEnabled: true, transferEnabled: true },
    王五: { autoAssignEnabled: false, transferEnabled: false },
    赵六: { autoAssignEnabled: true, transferEnabled: true }
  };
  assert.deepEqual(listTransferAutoOpenCandidates(rowMap, { transferAutoOpenEnabled: true }), ["张三"]);
});

test("配置关闭时不应该产生任何补开候选", () => {
  const { listTransferAutoOpenCandidates } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const rowMap = { 张三: { autoAssignEnabled: true, transferEnabled: false } };
  assert.deepEqual(listTransferAutoOpenCandidates(rowMap, { transferAutoOpenEnabled: false }), []);
  assert.deepEqual(listTransferAutoOpenCandidates(rowMap, {}), []);
});

test("补开动作应该只对缺失的客服点击，并把状态同步回 rowMap", async () => {
  // 这里通过 require 缓存注入假开关函数，验证自动补开的调用与状态同步。
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

  const { autoOpenTransferEnabled } = require(workflowModulePath);
  const rowMap = {
    张三: { autoAssignEnabled: true, transferEnabled: false },
    李四: { autoAssignEnabled: true, transferEnabled: true }
  };
  await autoOpenTransferEnabled({}, rowMap, { transferAutoOpenEnabled: true });
  assert.deepEqual(clicked, ["张三:true"]);
  assert.equal(rowMap.张三.transferEnabled, true);
  assert.equal(rowMap.李四.transferEnabled, true); // 已开启的不动
});

test("配置读取应默认开启自动补开转接待", () => {
  // 无人在线监控配置的默认值应包含自动补开且默认开启。
  const { loadReplyConfig } = require("../../src/config/replyConfigLoader");
  const config = loadReplyConfig();
  assert.equal(config.transferAutoOpenEnabled, true);
});
