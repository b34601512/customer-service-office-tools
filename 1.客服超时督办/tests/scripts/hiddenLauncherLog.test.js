const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

test("无黑窗启动器自检日志不应该写入 NUL 字节", () => {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const scriptPath = path.join(projectRoot, "scripts", "hidden-launcher.ps1");
  const currentRunLogPath = path.join(projectRoot, "runtime", "current-run.log");
  fs.mkdirSync(path.dirname(currentRunLogPath), { recursive: true });
  fs.writeFileSync(currentRunLogPath, "上一次运行日志", "utf8");
  const result = childProcess.spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-CheckOnly"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const logPath = path.join(projectRoot, "runtime", "hidden-launch.log");
  const content = fs.readFileSync(logPath);
  assert.equal(content.includes(0), false);
  assert.match(content.toString("utf8"), /自检模式通过/);
  assert.doesNotMatch(fs.readFileSync(currentRunLogPath, "utf8"), /上一次运行日志/);
});
