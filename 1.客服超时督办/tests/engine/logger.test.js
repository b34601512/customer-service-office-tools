const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  currentLogFilePath,
  currentLogResetEnvName,
  log,
  resetCurrentLogFileOnce
} = require("../../src/engine/logger");
const { subscribeLogs } = require("../../src/engine/logHub");

test("日志函数应该输出统一前缀并广播到日志总线", () => {
  let capturedConsoleLine = "";
  let capturedBroadcastLine = "";
  const originalConsoleLog = console.log;
  const unsubscribe = subscribeLogs((line) => {
    capturedBroadcastLine = line;
  });

  console.log = (line) => {
    capturedConsoleLine = line;
  };

  try {
    log("启动", "测试模块", "测试子动作", "测试消息");
  } finally {
    console.log = originalConsoleLog;
    unsubscribe();
  }

  assert.ok(capturedConsoleLine.includes("[主线:启动][测试模块][测试子动作] 测试消息"));
  assert.ok(capturedConsoleLine.includes("[logger.test.js:"));
  assert.equal(capturedBroadcastLine, capturedConsoleLine);
});

test("本次运行日志同一启动链路只应该清空一次", () => {
  const originalEnvValue = process.env[currentLogResetEnvName];
  const originalContent = fs.existsSync(currentLogFilePath)
    ? fs.readFileSync(currentLogFilePath, "utf8")
    : null;

  try {
    delete process.env[currentLogResetEnvName];
    fs.mkdirSync(path.dirname(currentLogFilePath), { recursive: true });
    fs.writeFileSync(currentLogFilePath, "上一次运行日志", "utf8");

    assert.equal(resetCurrentLogFileOnce(), true);
    assert.equal(fs.readFileSync(currentLogFilePath, "utf8").includes("上一次运行日志"), false);

    fs.writeFileSync(currentLogFilePath, "本次运行日志", "utf8");
    assert.equal(resetCurrentLogFileOnce(), false);
    assert.equal(fs.readFileSync(currentLogFilePath, "utf8").startsWith("本次运行日志"), true);
  } finally {
    if (originalEnvValue === undefined) {
      delete process.env[currentLogResetEnvName];
    } else {
      process.env[currentLogResetEnvName] = originalEnvValue;
    }

    if (originalContent === null) {
      fs.rmSync(currentLogFilePath, { force: true });
    } else {
      fs.writeFileSync(currentLogFilePath, originalContent, "utf8");
    }
  }
});
