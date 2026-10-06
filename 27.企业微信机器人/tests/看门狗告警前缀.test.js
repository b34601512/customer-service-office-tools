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
