const test = require("node:test");
const assert = require("node:assert/strict");

const { buildOffDutyConfig } = require("../../src/features/offDutyClose/offDutyConfig");
const {
  buildOffDutyCandidate,
  buildOffDutyCompletionNoticeKey,
  buildTodayShiftMapForPolicy,
  listScheduledOffDutyStaffNames,
  resolveStaffGroup
} = require("../../src/features/offDutyClose/offDutyPolicy");

function createRow(memberName, roleLabel, overrides = {}) {
  return {
    memberName,
    roleLabel,
    staffGroup: resolveStaffGroup(roleLabel),
    currentConversationCount: 0,
    rowKey: `${memberName}-row`,
    ...overrides
  };
}

test("昨天补检查应该跳过今天仍在上班的客服", () => {
  const shiftMap = {
    今天早班: { normalizedShift: "早班" },
    今天晚班: { normalizedShift: "晚班" },
    今天休息: { normalizedShift: "休息" }
  };

  assert.deepEqual(
    listScheduledOffDutyStaffNames(shiftMap, new Set(["今天早班", "今天晚班"])),
    []
  );
  assert.deepEqual(listScheduledOffDutyStaffNames(shiftMap), ["今天早班", "今天晚班"]);
});

test("售前早班到点后应该只关闭开关，不再生成转接规则", () => {
  const config = buildOffDutyConfig({});
  const rowMap = {
    马倩: createRow("马倩", "售前客服", { currentConversationCount: 2 }),
    顾远: createRow("顾远", "售前客服"),
    邓志豪: createRow("邓志豪", "售前客服")
  };
  const todayShiftMap = buildTodayShiftMapForPolicy(
    {
      马倩: { rawShift: "早", normalizedShift: "早班" },
      顾远: { rawShift: "晚", normalizedShift: "晚班" },
      邓志豪: { rawShift: "晚", normalizedShift: "晚班" }
    },
    rowMap
  );
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T16:35:00"),
    config,
    row: rowMap["马倩"],
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.workflowKind, "close_only");
  assert.equal(candidate.shiftStage, "early");
  assert.equal(candidate.silentClose, false);
  assert.equal("scheduledTransferTargetNames" in candidate, false);
});

test("售后早班到点后应该只关闭开关，不再自动释放对话", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("卢安", "售后客服", { currentConversationCount: 4 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    卢安: { rawShift: "早", normalizedShift: "早班" }
  }, { 卢安: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T16:35:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.workflowKind, "close_only");
  assert.equal(candidate.closeTimeText, "16:30");
});

test("售前晚班到点后也不应该自动给出任何转接动作", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("顾远", "售前客服", { currentConversationCount: 1 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    顾远: { rawShift: "晚", normalizedShift: "晚班" }
  }, { 顾远: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T23:50:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.workflowKind, "close_only");
  assert.equal("scheduledTransferTargetNames" in candidate, false);
});

test("跨午夜执行窗口里应该继续沿用原班次日期生成动作键", () => {
  const config = buildOffDutyConfig({
    offDutyPreSalesLateCloseTime: "23:50"
  });
  const row = createRow("顾远", "售前客服", { currentConversationCount: 1 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    顾远: { rawShift: "晚", normalizedShift: "晚班" }
  }, { 顾远: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-27T00:05:00+08:00"),
    shiftDate: new Date("2026-03-26T00:00:00+08:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.actionKey, "2026-03-26::顾远::晚班");
  assert.equal(candidate.closeAt.toISOString(), "2026-03-26T15:50:00.000Z");
});

test("售前晚班在上班开始前（未到岗）应该静默关闭且标记 silentClose", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("顾远", "售前客服", { currentConversationCount: 1 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    顾远: { rawShift: "晚", normalizedShift: "晚班" }
  }, { 顾远: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T10:00:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.silentClose, true);
  assert.equal(candidate.startTimeText, "15:45");
  assert.equal(candidate.closeTimeText, "23:45");
  assert.equal(candidate.actionKey, "2026-03-25::顾远::晚班");
});

test("售后晚班在 14:00 上班开始前也应该静默关闭", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("邓志豪", "售后客服", { currentConversationCount: 0 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    邓志豪: { rawShift: "晚", normalizedShift: "晚班" }
  }, { 邓志豪: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T12:00:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.silentClose, true);
  assert.equal(candidate.startTimeText, "14:00");
});

test("早班客服在当天上班开始前也应该静默关闭", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("马倩", "售前客服", { currentConversationCount: 0 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    马倩: { rawShift: "早", normalizedShift: "早班" }
  }, { 马倩: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T02:00:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.ok(candidate);
  assert.equal(candidate.silentClose, true);
  assert.equal(candidate.startTimeText, "08:00");
});

test("售前晚班在上班时间窗内（15:45~23:45）不应该生成关闭候选", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("顾远", "售前客服", { currentConversationCount: 1 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    顾远: { rawShift: "晚", normalizedShift: "晚班" }
  }, { 顾远: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T16:00:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.equal(candidate, null);
});

test("售后早班在上班时间窗内（08:00~16:30）不应该生成关闭候选", () => {
  const config = buildOffDutyConfig({});
  const row = createRow("卢安", "售后客服", { currentConversationCount: 1 });
  const todayShiftMap = buildTodayShiftMapForPolicy({
    卢安: { rawShift: "早", normalizedShift: "早班" }
  }, { 卢安: row });
  const candidate = buildOffDutyCandidate({
    now: new Date("2026-03-25T10:00:00"),
    config,
    row,
    todayShiftMap,
    tomorrowShiftMap: {}
  });

  assert.equal(candidate, null);
});

test("完成通知键应该按日期和客服名去重", () => {
  assert.equal(
    buildOffDutyCompletionNoticeKey(new Date("2026-03-26T00:00:00+08:00"), "顾远"),
    "2026-03-26::顾远::off_duty_closed_notice"
  );
});
