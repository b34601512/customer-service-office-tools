const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OFF_DUTY_DEFAULT_SCAN_INTERVAL_MS,
  buildOffDutyConfig
} = require("../../src/features/offDutyClose/offDutyConfig");
const { resolveOffDutyScanDates } = require("../../src/features/offDutyClose/offDutyRunWindow");

test("下班检查默认应该每 5 分钟执行一次", () => {
  assert.equal(OFF_DUTY_DEFAULT_SCAN_INTERVAL_MS, 5 * 60 * 1000);
  assert.equal(buildOffDutyConfig({}).offDutyScanIntervalMs, 5 * 60 * 1000);
});

test("每轮检查应该覆盖昨天和今天，支持第二天启动补处理", () => {
  const scanDates = resolveOffDutyScanDates(new Date("2026-03-27T09:00:00+08:00"));

  assert.equal(scanDates.length, 2);
  assert.equal(scanDates[0].getFullYear(), 2026);
  assert.equal(scanDates[0].getMonth(), 2);
  assert.equal(scanDates[0].getDate(), 26);
  assert.equal(scanDates[1].getDate(), 27);
  assert.equal(scanDates[0].getHours(), 0);
  assert.equal(scanDates[1].getHours(), 0);
});
