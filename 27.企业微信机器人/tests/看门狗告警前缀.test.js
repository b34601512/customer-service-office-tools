const test = require("node:test");
const assert = require("node:assert/strict");
const { alertTag } = require("../src/watchdog");

test("消息静默类告警用 [通知]（不吓人）", () => {
  assert.equal(alertTag(["group"]), "[通知]");
  assert.equal(alertTag(["single"]), "[通知]");
  assert.equal(alertTag(["both"]), "[通知]");
});

test("确定性故障仍用 [故障]", () => {
  assert.equal(alertTag(["daemon"]), "[故障]");
  assert.equal(alertTag(["connection"]), "[故障]");
});

test("混合时按最严重（有确定性故障就是 [故障]）", () => {
  assert.equal(alertTag(["group", "connection"]), "[故障]");
  assert.equal(alertTag([]), "[通知]");
});

test("服务端对账发现漏消息：静默类也升 [故障]（2026-10-07）", () => {
  assert.equal(alertTag(["both"], 1), "[故障]");
  assert.equal(alertTag(["both"], 0), "[通知]");
  assert.equal(alertTag(["group"], 2), "[故障]");
});
