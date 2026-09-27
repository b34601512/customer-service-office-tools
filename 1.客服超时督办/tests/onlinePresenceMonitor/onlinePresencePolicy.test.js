const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listOnDutyShiftStagesForGroup,
  resolveExpectedShiftStageForGroup,
  summarizeOnlinePresenceStatus
} = require("../../src/features/onlinePresenceMonitor/onlinePresencePolicy");

function createConfig(overrides = {}) {
  return {
    onlinePresenceWorkStartTime: "08:00",
    offDutyPreSalesEarlyCloseTime: "16:00",
    offDutyPreSalesLateCloseTime: "23:45",
    offDutyAfterSalesEarlyCloseTime: "16:00",
    offDutyAfterSalesLateCloseTime: "22:30",
    ...overrides
  };
}

function createRow(memberName, roleLabel, autoAssignEnabled, transferEnabled = false) {
  return {
    memberName,
    roleLabel,
    autoAssignEnabled,
    transferEnabled
  };
}

test("无人在线提醒应该在凌晨开始判断时间前不进入值班判断", () => {
  const stage = resolveExpectedShiftStageForGroup(
    createConfig(),
    "after_sales",
    new Date("2026-06-26T02:00:00+08:00")
  );

  assert.equal(stage, "");
});

test("无人在线提醒应该按售前实际早晚班时间判断", () => {
  assert.equal(
    resolveExpectedShiftStageForGroup(createConfig(), "pre_sales", new Date("2026-06-26T15:44:00+08:00")),
    "early"
  );
  assert.equal(
    resolveExpectedShiftStageForGroup(createConfig(), "pre_sales", new Date("2026-06-26T15:45:00+08:00")),
    "late"
  );
  assert.equal(
    resolveExpectedShiftStageForGroup(createConfig(), "pre_sales", new Date("2026-06-26T23:45:00+08:00")),
    ""
  );
});

test("无人在线提醒应该覆盖售后早班到晚班结束", () => {
  assert.equal(
    resolveExpectedShiftStageForGroup(createConfig(), "after_sales", new Date("2026-06-26T13:59:00+08:00")),
    "early"
  );
  assert.equal(
    resolveExpectedShiftStageForGroup(createConfig(), "after_sales", new Date("2026-06-26T14:00:00+08:00")),
    "late"
  );
  assert.equal(
    resolveExpectedShiftStageForGroup(createConfig(), "after_sales", new Date("2026-06-26T22:30:00+08:00")),
    ""
  );
});

test("在岗班次集合应该覆盖售前早晚班重叠期 15:45~16:00", () => {
  const config = createConfig();

  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "pre_sales", new Date("2026-06-26T15:44:00+08:00")),
    ["early"]
  );
  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "pre_sales", new Date("2026-06-26T15:45:00+08:00")),
    ["early", "late"]
  );
  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "pre_sales", new Date("2026-06-26T16:00:00+08:00")),
    ["late"]
  );
  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "pre_sales", new Date("2026-06-26T23:45:00+08:00")),
    []
  );
});

test("在岗班次集合应该覆盖售后早晚班重叠期 14:00~16:00", () => {
  const config = createConfig();

  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "after_sales", new Date("2026-06-26T13:59:00+08:00")),
    ["early"]
  );
  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "after_sales", new Date("2026-06-26T14:00:00+08:00")),
    ["early", "late"]
  );
  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "after_sales", new Date("2026-06-26T16:00:00+08:00")),
    ["late"]
  );
  assert.deepEqual(
    listOnDutyShiftStagesForGroup(config, "after_sales", new Date("2026-06-26T22:30:00+08:00")),
    []
  );
});

test("早班还在岗时晚班没上线不提醒，16:00 早班下班后晚班没人则提醒", () => {
  const todayShiftMap = {
    早班客服: { normalizedShift: "早班" },
    晚班客服: { normalizedShift: "晚班" }
  };
  const rowMap = {
    早班客服: createRow("早班客服", "售前客服", false, true),
    晚班客服: createRow("晚班客服", "售前客服", false, false)
  };

  const duringOverlap = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T15:50:00+08:00"),
    todayShiftMap,
    rowMap
  });
  assert.deepEqual(duringOverlap.expectedStaffNames, ["早班客服", "晚班客服"]);
  assert.deepEqual(duringOverlap.onlineStaffNames, ["早班客服"]);
  assert.equal(duringOverlap.shouldNotify, false);

  const afterEarlyClose = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:05:00+08:00"),
    todayShiftMap,
    rowMap
  });
  assert.deepEqual(afterEarlyClose.expectedStaffNames, ["晚班客服"]);
  assert.deepEqual(afterEarlyClose.onlineStaffNames, []);
  assert.equal(afterEarlyClose.shouldNotify, true);
});

test("售前有人在线但售后无人在线时仍然应该提醒", () => {
  const summary = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:10:00+08:00"),
    todayShiftMap: {
      售后客服甲: { normalizedShift: "晚班" },
      售前客服乙: { normalizedShift: "晚班" }
    },
    rowMap: {
      售后客服甲: createRow("售后客服甲", "售后客服", false),
      售前客服乙: createRow("售前客服乙", "售前客服", false, true)
    }
  });

  assert.deepEqual(summary.expectedStaffNames, ["售后客服甲", "售前客服乙"]);
  assert.deepEqual(summary.onlineStaffNames, ["售前客服乙"]);
  assert.equal(summary.shouldNotify, true);
});

test("售后有人在线但售前无人在线时仍然应该提醒", () => {
  const summary = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:10:00+08:00"),
    todayShiftMap: {
      售后客服甲: { normalizedShift: "晚班" },
      售前客服乙: { normalizedShift: "晚班" }
    },
    rowMap: {
      售后客服甲: createRow("售后客服甲", "售后客服", true),
      售前客服乙: createRow("售前客服乙", "售前客服", false, false)
    }
  });

  assert.deepEqual(summary.onlineStaffNames, ["售后客服甲"]);
  assert.equal(summary.shouldNotify, true);
});

test("当前应值班客服有一人开启自动分配就不提醒", () => {
  const summary = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:10:00+08:00"),
    todayShiftMap: {
      郑兰: { normalizedShift: "晚班" },
      马倩: { normalizedShift: "晚班" },
      裴雨: { normalizedShift: "早班" }
    },
    rowMap: {
      郑兰: createRow("郑兰", "售后客服", true),
      马倩: createRow("马倩", "售后客服", false),
      裴雨: createRow("裴雨", "售前客服", false)
    }
  });

  assert.deepEqual(summary.expectedStaffNames, ["郑兰", "马倩"]);
  assert.deepEqual(summary.onlineStaffNames, ["郑兰"]);
  assert.equal(summary.shouldNotify, false);
});

test("当前应值班客服全部未开启自动分配才提醒", () => {
  const summary = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:10:00+08:00"),
    todayShiftMap: {
      郑兰: { normalizedShift: "晚班" },
      马倩: { normalizedShift: "晚班" }
    },
    rowMap: {
      郑兰: createRow("郑兰", "售后客服", false),
      马倩: createRow("马倩", "售后客服", false)
    }
  });

  assert.deepEqual(summary.expectedStaffNames, ["郑兰", "马倩"]);
  assert.deepEqual(summary.offlineStaffNames, ["郑兰", "马倩"]);
  assert.equal(summary.canDecide, true);
  assert.equal(summary.shouldNotify, true);
});

test("汇总应值班名单时应该带上每个人的分组，供提醒文案精准到组", () => {
  const summary = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:10:00+08:00"),
    todayShiftMap: {
      售后客服甲: { normalizedShift: "晚班" },
      售前客服乙: { normalizedShift: "晚班" }
    },
    rowMap: {
      售后客服甲: createRow("售后客服甲", "售后客服", false),
      售前客服乙: createRow("售前客服乙", "售前客服", false)
    }
  });

  assert.deepEqual(summary.staffGroupByExpectedName, {
    售后客服甲: "after_sales",
    售前客服乙: "pre_sales"
  });
  assert.equal(summary.shouldNotify, true);
});

test("成员状态读取不完整时不应该贸然提醒", () => {
  const summary = summarizeOnlinePresenceStatus({
    config: createConfig(),
    now: new Date("2026-06-26T16:10:00+08:00"),
    todayShiftMap: {
      郑兰: { normalizedShift: "晚班" },
      马倩: { normalizedShift: "晚班" }
    },
    rowMap: {
      郑兰: createRow("郑兰", "售后客服", false)
    },
    readFailedStaffNames: ["马倩"]
  });

  assert.equal(summary.canDecide, false);
  assert.equal(summary.shouldNotify, false);
});
