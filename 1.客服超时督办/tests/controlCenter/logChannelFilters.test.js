const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLogChannels } = require("../../src/controlCenter/logChannelFilters");

test("日志通道应该把下班企微发送划到下班监控日志", () => {
  const line =
    "[2026-03-25 16:21:10.000][wecomRobot.js:8][主线:完成][企微机器人][发送成功] 场景=下班自动关闭，目标=主管群";

  assert.deepEqual(resolveLogChannels(line), ["off_duty"]);
});

test("日志通道应该把超时企微发送保留在超时日志", () => {
  const line =
    "[2026-03-25 16:21:10.000][wecomRobot.js:8][主线:完成][企微机器人][发送成功] 场景=超时提醒，目标=主管群";

  assert.deepEqual(resolveLogChannels(line), ["timeout"]);
});

test("日志通道应该识别下班监控主流程", () => {
  const line =
    "[2026-03-25 16:21:00.000][offDutyWorkflow.js:299][主线:完成][下班监控][处理完成] 客服=易凡 已完成下班收尾";

  assert.deepEqual(resolveLogChannels(line), ["off_duty"]);
});

test("日志通道应该把独立转接监控归到超时日志通道", () => {
  const line =
    "[2026-04-16 11:58:00.000][transferMonitorWorkflow.js:160][主线:完成][转接监控][发送提醒] 客户=罗马假日，动作=转接";

  assert.deepEqual(resolveLogChannels(line), ["timeout"]);
});

test("日志通道应该把漏回复主流程归到漏回复日志", () => {
  const line =
    "[2026-06-25 09:30:00.000][missedReplyWorkflow.js:160][主线:完成][未实质回复监控][发送提醒] 类型=漏回复，客户=罗马假日，轮次=1";

  assert.deepEqual(resolveLogChannels(line), ["missed_reply"]);
});

test("日志通道应该把漏回复企微发送归到漏回复日志", () => {
  const line =
    "[2026-06-25 09:30:01.000][wecomRobot.js:8][主线:完成][企微机器人][发送成功] 场景=漏回复提醒，目标=主管群";

  assert.deepEqual(resolveLogChannels(line), ["missed_reply"]);
});

test("日志通道应该把上班监控主流程归到上班监控日志", () => {
  const line =
    "[2026-06-26 16:00:00.000][onlinePresenceWorkflow.js:160][主线:完成][上班监控][发送提醒] 应值班客服=郑兰";

  assert.deepEqual(resolveLogChannels(line), ["online_presence"]);
});

test("日志通道应该把上班监控企微发送归到上班监控日志", () => {
  const line =
    "[2026-06-26 16:00:01.000][wecomRobot.js:8][主线:完成][企微机器人][发送成功] 场景=上班监控，目标=主管群";

  assert.deepEqual(resolveLogChannels(line), ["online_presence"]);
});
