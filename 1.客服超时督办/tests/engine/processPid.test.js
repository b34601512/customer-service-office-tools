const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeProcessPid, processExistsByPid } = require("../../src/engine/processPid");

test("PID 存活检查应该走 Node 原生能力，不依赖 PowerShell", () => {
  assert.equal(normalizeProcessPid(process.pid), process.pid);
  assert.equal(normalizeProcessPid("0"), 0);
  assert.equal(normalizeProcessPid("abc"), 0);
  assert.equal(processExistsByPid(process.pid), true);
  assert.equal(processExistsByPid(0), false);
});
