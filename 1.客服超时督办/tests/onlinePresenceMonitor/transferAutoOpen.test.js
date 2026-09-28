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
  assert.deepEqual(
    listTransferAutoOpenCandidates(rowMap, { transferAutoOpenEnabled: true }, {
      onDutyStaffNames: ["张三", "李四", "王五", "赵六"]
    }),
    ["张三"]
  );
});

test("16:00 早班下班收尾后，不在岗的客服不得再被补开转接待", () => {
  // 现场（2026-09-28 16:00）：下班监控刚关掉陈十四的转接待，上班监控 15 秒后又因
  // 「自动分配还开着」把它补开，群里却已留下“已完成下班收尾”。修复后只允许补开当前在岗的人。
  const { listTransferAutoOpenCandidates } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const { listExpectedOnlineStaff } = require("../../src/features/onlinePresenceMonitor/onlinePresencePolicy");
  const config = {
    transferAutoOpenEnabled: true,
    onlinePresenceWorkStartTime: "08:00",
    offDutyPreSalesEarlyCloseTime: "16:00",
    offDutyPreSalesLateCloseTime: "23:45",
    offDutyAfterSalesEarlyCloseTime: "16:00",
    offDutyAfterSalesLateCloseTime: "22:30"
  };
  const shiftMap = {
    陈十四: { normalizedShift: "早班" },
    周八: { normalizedShift: "晚班" }
  };
  const rowMap = {
    陈十四: { roleLabel: "售后", autoAssignEnabled: true, transferEnabled: false },
    周八: { roleLabel: "售后", autoAssignEnabled: true, transferEnabled: false }
  };
  const onDutyStaffNames = listExpectedOnlineStaff(shiftMap, rowMap, config, new Date(2026, 8, 28, 16, 5, 0));
  assert.deepEqual(onDutyStaffNames, ["周八"]);
  assert.deepEqual(
    listTransferAutoOpenCandidates(rowMap, config, { onDutyStaffNames }),
    ["周八"]
  );
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
  await autoOpenTransferEnabled({}, rowMap, { transferAutoOpenEnabled: true }, { onDutyStaffNames: ["张三", "李四"] });
  assert.deepEqual(clicked, ["张三:true"]);
  assert.equal(rowMap.张三.transferEnabled, true);
  assert.equal(rowMap.李四.transferEnabled, true); // 已开启的不动
});

test("补开动作不得触碰不在岗名单之外的人", async () => {
  // 这里通过 require 缓存注入假开关函数，验证不在岗客服即使“自动分配开、转接待关”也不点击。
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
    李四: { autoAssignEnabled: true, transferEnabled: false }
  };
  await autoOpenTransferEnabled({}, rowMap, { transferAutoOpenEnabled: true }, { onDutyStaffNames: ["张三"] });
  assert.deepEqual(clicked, ["张三:true"]);
  assert.equal(rowMap.张三.transferEnabled, true);
  assert.equal(rowMap.李四.transferEnabled, false); // 不在岗，必须保持关闭
});

test("配置读取应默认开启自动补开转接待", () => {
  // 无人在线监控配置的默认值应包含自动补开且默认开启。
  const { loadReplyConfig } = require("../../src/config/replyConfigLoader");
  const config = loadReplyConfig();
  assert.equal(config.transferAutoOpenEnabled, true);
});
