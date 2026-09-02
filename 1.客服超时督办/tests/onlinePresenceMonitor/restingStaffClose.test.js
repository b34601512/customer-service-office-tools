const test = require("node:test");
const assert = require("node:assert/strict");

test("休息名单应该把非早晚班人员一律挑出（空白/年假/请假/行政等）", () => {
  const { listRestingStaffNames } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const shiftMap = {
    张三: { normalizedShift: "早班" },
    李四: { normalizedShift: "晚班" },
    王五: { normalizedShift: "休息" },
    赵六: { normalizedShift: "年假" },
    孙七: { normalizedShift: "假" },
    周八: { normalizedShift: "行政" }
  };
  assert.deepEqual(listRestingStaffNames(shiftMap), ["王五", "赵六", "孙七", "周八"]);
});

test("休息名单应该忽略早晚班人员", () => {
  const { listRestingStaffNames } = require("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const shiftMap = {
    张三: { normalizedShift: "早班" },
    李四: { normalizedShift: "晚班" }
  };
  assert.deepEqual(listRestingStaffNames(shiftMap), []);
});

test("休息人员自动关闭应该把开着的自动分配和可被转接都关掉，并同步 rowMap", async () => {
  // 这里通过 require 缓存注入假开关函数，验证休息人员关闭动作与状态同步。
  const workflowModulePath = require.resolve("../../src/features/onlinePresenceMonitor/onlinePresenceWorkflow");
  const memberSwitchModulePath = require.resolve("../../src/features/offDutyClose/memberSettingsPage/memberSwitch");
  const clicked = [];
  require.cache[memberSwitchModulePath] = {
    id: memberSwitchModulePath,
    filename: memberSwitchModulePath,
    loaded: true,
    exports: {
      async setMemberAutoAssign(page, staffName, enabled) {
        clicked.push(`${staffName}:autoAssign:${enabled}`);
        return true;
      },
      async setMemberTransferEnabled(page, staffName, enabled) {
        clicked.push(`${staffName}:transfer:${enabled}`);
        return true;
      }
    }
  };
  delete require.cache[workflowModulePath];

  const { autoCloseRestingStaffSwitches } = require(workflowModulePath);
  const restingRowMap = {
    王五: { autoAssignEnabled: true, transferEnabled: true },
    赵六: { autoAssignEnabled: true, transferEnabled: false },
    孙七: { autoAssignEnabled: false, transferEnabled: true },
    周八: { autoAssignEnabled: false, transferEnabled: false }
  };
  await autoCloseRestingStaffSwitches({}, restingRowMap);
  assert.deepEqual(clicked, [
    "王五:autoAssign:false",
    "王五:transfer:false",
    "赵六:autoAssign:false",
    "孙七:transfer:false"
  ]);
  assert.equal(restingRowMap.王五.autoAssignEnabled, false);
  assert.equal(restingRowMap.王五.transferEnabled, false);
  assert.equal(restingRowMap.赵六.autoAssignEnabled, false);
  assert.equal(restingRowMap.孙七.transferEnabled, false);
  assert.equal(restingRowMap.周八.autoAssignEnabled, false); // 本来就关的不动
  assert.equal(restingRowMap.周八.transferEnabled, false);
});