const assert = require("assert");
const path = require("path");
const { normalizeMenuAnswer } = require("../src/cli/cliTerminal");
const { isValidCalendarDate, requireValidDateRange } = require("../src/cli/cliConfigMenus");
const { parseSourceNames } = require("../src/cli/cliPersonMappingMenu");
const { resolveExistingDirectory } = require("../src/cli/cliRuntime");
const { resolveTaskDateRange } = require("../src/summary/configuredWorkflowParts/configuredSummaryRunner");

assert.strictEqual(normalizeMenuAnswer(" H "), "h");
assert.strictEqual(isValidCalendarDate("2026-02-28"), true);
assert.strictEqual(isValidCalendarDate("2026-02-30"), false);
assert.throws(() => requireValidDateRange("2026-08-02", "2026-08-01"), /开始日期/);
assert.deepStrictEqual(parseSourceNames("小王, 小王，旺旺01"), ["小王", "旺旺01"]);
assert.strictEqual(resolveExistingDirectory(__filename, __dirname), __dirname);
assert.strictEqual(resolveExistingDirectory(path.join(__dirname, "不存在.xlsx"), __dirname), __dirname);
assert.deepStrictEqual(resolveTaskDateRange({ exportDateRangeStartText: "2026-06-15", exportDateRangeEndText: "2026-07-14", usesGlobalExportDateRange: false }, { marker: true }), {
  marker: true,
  startText: "2026-06-15", endText: "2026-07-14",
  start: { type: "custom_date", offsetDays: 0, customDate: "2026-06-15" },
  end: { type: "custom_date", offsetDays: 0, customDate: "2026-07-14" },
  mode: "store_manual"
});
console.log("PASS CLI输入、日期、客服映射与单店日期执行规则");
