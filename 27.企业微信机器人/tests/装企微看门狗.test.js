const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 2026-10-14 主窗复核补记：模板必须与已装启动器一致（全员按需 → 不查窗口心跳）。
// 背景：10-13 手改启动器（C:\Users\b3460\.config\wecom-watchdog\watchdog.ps1）加了 --no-heartbeat，
// 但安装脚本模板没同步——重装会把改动静默冲掉，这里用测试锁死。
test("装狗模板：启动器命令带 --no-heartbeat（防重装回退，10-13 全员按需）", () => {
  const 源 = fs.readFileSync(path.join(__dirname, "..", "scripts", "装企微看门狗.cjs"), "utf8");
  assert.ok(源.includes("$node $script --no-heartbeat"), "安装脚本生成的启动器命令应带 --no-heartbeat");
});
