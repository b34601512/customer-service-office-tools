const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// 旧测试会写 runtime；整套测试放在明确的临时目录，绝不恢复/覆盖生产日志。
const projectRoot = path.resolve(__dirname, "..");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-tests-"));
for (const entry of ["src", "tests", "scripts", "README.md", "启动中心.bat", "package.json", "package-lock.json"]) {
  fs.cpSync(path.join(projectRoot, entry), path.join(testRoot, entry), { recursive: true });
}
fs.mkdirSync(path.join(testRoot, "project-config"));
fs.copyFileSync(path.join(projectRoot, "project-config", "reply-config.js"), path.join(testRoot, "project-config", "reply-config.js"));
fs.writeFileSync(path.join(testRoot, "project-config", "app-config.json"), JSON.stringify({ targetUrl: "https://example.test/main/org/group/chat", scheduleUrl: "", managerStaffName: "黎路遥" }));
fs.writeFileSync(path.join(testRoot, "project-config", "wecom-robot.json"), "{}");
fs.cpSync(path.join(projectRoot, "node_modules", "playwright-core"), path.join(testRoot, "node_modules", "playwright-core"), { recursive: true });
console.log(`隔离测试目录：${testRoot}`);
const requestedTests = process.argv.slice(2);
const testFiles = requestedTests.length ? requestedTests : fs.readdirSync(path.join(testRoot, "tests"), { recursive: true })
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => path.join("tests", name));
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: testRoot, stdio: "inherit", windowsHide: true
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
