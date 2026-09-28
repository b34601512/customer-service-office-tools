const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");

const {
  parseVersion,
  isVersionAtLeast,
  parseAuthStatus,
  collectSkillPaths
} = require("../scripts/检查企微环境.js");

test("parseVersion：从 wecom-cli 输出中取出语义版本", () => {
  assert.deepEqual(parseVersion("wecom-cli 1.3.4 (wecom 2026-09-23T11:47:44Z f9b2815)"), [1, 3, 4]);
  assert.equal(parseVersion("no version here"), null);
});

test("isVersionAtLeast：1.2.1 为最低可用版本", () => {
  assert.equal(isVersionAtLeast("wecom-cli 1.3.4", "1.2.1"), true);
  assert.equal(isVersionAtLeast("1.2.1", "1.2.1"), true);
  assert.equal(isVersionAtLeast("1.2.0", "1.2.1"), false);
  assert.equal(isVersionAtLeast("1.1.9", "1.2.1"), false);
});

test("parseAuthStatus：unauthorized 不能被误判成 authorized", () => {
  assert.equal(parseAuthStatus("unauthorized"), "unauthorized");
  assert.equal(parseAuthStatus("authorized"), "authorized");
  assert.equal(parseAuthStatus("  AUTHORIZED \n"), "authorized");
  assert.equal(parseAuthStatus(""), "unknown");
  assert.equal(parseAuthStatus("some error"), "unknown");
});

test("collectSkillPaths：覆盖 .agents / .claude / .pi 三个常见安装位置", () => {
  const paths = collectSkillPaths(os.homedir());
  assert.equal(paths.length, 3);
  assert.ok(paths.every((item) => item.endsWith("wecom-unified\\SKILL.md") || item.endsWith("wecom-unified/SKILL.md")));
});
