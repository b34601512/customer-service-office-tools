const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const scheduleQueryConfig = require("../../src/features/scheduleQuery/scheduleQueryConfig");
const { clearSnapshotDir } = require("../../src/features/scheduleQuery/scheduleSnapshotStore");

test("清理排班快照目录在未传路径时应该使用默认配置目录", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-snapshot-store-"));
  const tempSnapshotDir = path.join(tempRoot, "snapshots");
  const originalSnapshotDir = scheduleQueryConfig.snapshotDir;

  try {
    scheduleQueryConfig.snapshotDir = tempSnapshotDir;
    fs.mkdirSync(path.join(tempSnapshotDir, "old-folder"), { recursive: true });
    fs.writeFileSync(path.join(tempSnapshotDir, "old.tsv"), "根目录历史快照", "utf8");
    fs.writeFileSync(path.join(tempSnapshotDir, "old-folder", "old.tsv"), "历史快照", "utf8");

    clearSnapshotDir();

    assert.equal(fs.existsSync(tempSnapshotDir), true);
    assert.deepEqual(fs.readdirSync(tempSnapshotDir), []);
  } finally {
    scheduleQueryConfig.snapshotDir = originalSnapshotDir;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
