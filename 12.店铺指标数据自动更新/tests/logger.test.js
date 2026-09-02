const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveLogColorCode,
  formatConsoleLogForDisplay
} = require("../src/engine/logger");

function createLogEntry(overrides = {}) {
  return {
    level: "info",
    mainAction: "主线:执行",
    text: "日志内容",
    ...overrides
  };
}

test("日志完成显示绿色，失败和错误显示红色", () => {
  assert.equal(
    resolveLogColorCode(createLogEntry({ mainAction: "主线:完成" })),
    "\u001b[32m"
  );
  assert.equal(
    resolveLogColorCode(createLogEntry({ mainAction: "主线:失败" })),
    "\u001b[31m"
  );
  assert.equal(
    resolveLogColorCode(createLogEntry({ mainAction: "主线:错误" })),
    "\u001b[31m"
  );
  assert.equal(
    resolveLogColorCode(createLogEntry({ level: "error" })),
    "\u001b[31m"
  );
});

test("等待和执行日志不误染色，终端关闭颜色时保持纯文本", () => {
  const waitingEntry = createLogEntry({ mainAction: "主线:等待" });
  const successEntry = createLogEntry({ mainAction: "主线:完成" });

  assert.equal(resolveLogColorCode(waitingEntry), "");
  assert.equal(formatConsoleLogForDisplay(waitingEntry, true), "日志内容");
  assert.equal(formatConsoleLogForDisplay(successEntry, false), "日志内容");
  assert.equal(
    formatConsoleLogForDisplay(successEntry, true),
    "\u001b[32m日志内容\u001b[0m"
  );
});
