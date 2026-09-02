const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveCurrentDiskBackupRoot } = require("../../src/config/backupRoot");

test("备份目录应该跟随项目所在硬盘根目录", () => {
  assert.equal(resolveCurrentDiskBackupRoot("D:\\桌面\\办公软件\\项目"), "D:\\备份文件夹");
});
