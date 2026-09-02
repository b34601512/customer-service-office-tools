const test = require("node:test");
const assert = require("node:assert/strict");
const { ControlCenterState } = require("../../src/controlCenter/controlCenterState");

test("控制台状态应该缓存最近 200 条日志并广播 state 事件", () => {
  const state = new ControlCenterState();
  const logPayloads = [];
  const statePayloads = [];

  state.eventBus.on("log", (payload) => {
    logPayloads.push(payload);
  });
  state.eventBus.on("state", (payload) => {
    statePayloads.push(payload);
  });

  for (let index = 1; index <= 205; index += 1) {
    state.appendLog(`日志-${index}`);
  }

  assert.equal(logPayloads.length, 205);
  assert.equal(statePayloads.length, 205);
  assert.deepEqual(logPayloads.at(-1), { line: "日志-205", channels: [] });
  assert.equal(state.getSnapshot().logLines.length, 200);
  assert.equal(state.getSnapshot().logLines[0], "日志-6");
  assert.equal(state.getSnapshot().logLines.at(-1), "日志-205");
  assert.deepEqual(state.getSnapshot().logLinesByChannel, {
    timeout: [],
    missed_reply: [],
    online_presence: [],
    off_duty: []
  });
});

test("控制台状态更新任务时应该通过 state 事件同步最新快照", () => {
  const state = new ControlCenterState();
  const snapshots = [];

  state.eventBus.on("state", (payload) => {
    snapshots.push(payload);
  });

  state.setTask({
    taskName: "start",
    status: "running",
    message: "后台督办执行中"
  });

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].currentTask.taskName, "start");
  assert.equal(snapshots[0].currentTask.status, "running");
  assert.deepEqual(snapshots[0].logLines, []);
  assert.deepEqual(snapshots[0].logLinesByChannel, {
    timeout: [],
    missed_reply: [],
    online_presence: [],
    off_duty: []
  });
});

test("控制台状态应该按通道分别缓存超时、漏回复、无人在线和下班日志", () => {
  const state = new ControlCenterState();
  const timeoutLine =
    "[2026-03-25 16:21:10.000][wecomRobot.js:8][主线:完成][企微机器人][发送成功] 场景=超时提醒，目标=主管群";
  const offDutyLine =
    "[2026-03-25 16:21:00.000][offDutyWorkflow.js:299][主线:完成][下班监控][处理完成] 客服=易凡 已完成下班收尾";
  const offDutyWecomLine =
    "[2026-03-25 16:21:10.000][wecomRobot.js:8][主线:完成][企微机器人][发送成功] 场景=下班自动关闭，目标=主管群";
  const missedReplyLine =
    "[2026-06-25 09:30:00.000][missedReplyWorkflow.js:160][主线:完成][未实质回复监控][发送提醒] 类型=漏回复，客户=罗马假日，轮次=1";
  const onlinePresenceLine =
    "[2026-06-26 16:00:00.000][onlinePresenceWorkflow.js:160][主线:完成][上班监控][发送提醒] 应值班客服=郑兰";

  state.appendLog(timeoutLine);
  state.appendLog(offDutyLine);
  state.appendLog(offDutyWecomLine);
  state.appendLog(missedReplyLine);
  state.appendLog(onlinePresenceLine);

  assert.deepEqual(state.getSnapshot().logLinesByChannel, {
    timeout: [timeoutLine],
    missed_reply: [missedReplyLine],
    online_presence: [onlinePresenceLine],
    off_duty: [offDutyLine, offDutyWecomLine]
  });
});
