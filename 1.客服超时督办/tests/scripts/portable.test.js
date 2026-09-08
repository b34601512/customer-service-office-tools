const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildPortable } = require("../../scripts/build-portable");

test("分享包不携带运行资料、真实账号配置或共享CLI依赖", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "portable-contract-"));
  const root = buildPortable(parent, { includeNode: false });
  assert.equal(fs.existsSync(path.join(root, "runtime")), false);
  assert.equal(fs.existsSync(path.join(root, "tests")), false);
  assert.equal(fs.existsSync(path.join(root, ".git")), false);
  const config = JSON.parse(fs.readFileSync(path.join(root, "project-config", "app-config.json"), "utf8"));
  assert.equal(config.targetUrl, "https://zan-mh.xiaoshunai.com/");
  assert.equal(config.scheduleUrl, "");
  const wecom = JSON.parse(fs.readFileSync(path.join(root, "project-config", "wecom-robot.json"), "utf8"));
  assert.deepEqual(wecom, { notification_groups: [], member_directory: [] });
  const entry = fs.readFileSync(path.join(root, "src", "controlCenter", "startControlCenter.js"), "utf8");
  assert.doesNotMatch(entry, /共享CLI/);
});
