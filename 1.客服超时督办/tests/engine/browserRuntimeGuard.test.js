const test = require("node:test");
const assert = require("node:assert/strict");
const { usesBrowserProfile, assertBrowserProfileAvailable } = require("../../src/engine/browserRuntimeGuard");

test("Edge 目录必须完整匹配参数，不匹配个人目录或相邻目录", () => {
  const profile = "D:\\任务 空格\\runtime\\edge-user-data";
  assert.equal(usesBrowserProfile('msedge.exe "--user-data-dir=' + profile + '" --headless', profile), true);
  assert.equal(usesBrowserProfile('msedge.exe --user-data-dir="' + profile + '"', profile), true);
  assert.equal(usesBrowserProfile('msedge.exe "--user-data-dir=' + profile + '-other"', profile), false);
  assert.equal(usesBrowserProfile('msedge.exe --app="' + profile + '"', profile), false);
  assert.equal(usesBrowserProfile('msedge.exe --user-data-dir=C:\\Users\\personal', profile), false);
});

test("资料占用时只报错，不启动 taskkill 或删除文件", { skip: process.platform !== "win32" }, () => {
  let calls = 0;
  const query = (command, args) => {
    calls++;
    assert.equal(command, "powershell.exe");
    assert.match(args.join(" "), /msedge\.exe/);
    assert.doesNotMatch(args.join(" "), /taskkill|Remove-Item/);
    return { status: 0, stdout: JSON.stringify({ CommandLine: "msedge.exe --user-data-dir=D:\\app\\edge" }) };
  };
  assert.throws(() => assertBrowserProfileAvailable("D:\\app\\edge", query), /目录正在使用/);
  assert.equal(calls, 1);
});

test("查询失败不能假装目录空闲", { skip: process.platform !== "win32" }, () => {
  assert.throws(() => assertBrowserProfileAvailable("D:\\app\\edge", () => ({ status: 1, stderr: "denied" })), /denied/);
});
