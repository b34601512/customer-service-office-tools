const test = require("node:test");
const assert = require("node:assert/strict");

test("启动后台前若 Edge 目录已占用应直接拒绝，不再拉起闪退子进程", async () => {
  const taskStartPreflightPath = require.resolve("../../src/controlCenter/taskService/taskStartPreflight");
  const windowsSnapshotPath = require.resolve("../../src/controlCenter/resourceMonitor/windowsProcessSnapshot");
  const browserGuardPath = require.resolve("../../src/engine/browserRuntimeGuard");
  const originalPreflightCache = require.cache[taskStartPreflightPath];
  const originalSnapshotCache = require.cache[windowsSnapshotPath];
  const originalGuardCache = require.cache[browserGuardPath];

  require.cache[browserGuardPath] = {
    id: browserGuardPath,
    filename: browserGuardPath,
    loaded: true,
    exports: {
      assertBrowserProfileAvailable() {
        throw new Error("应用 Edge 目录正在使用");
      }
    }
  };
  require.cache[windowsSnapshotPath] = {
    id: windowsSnapshotPath,
    filename: windowsSnapshotPath,
    loaded: true,
    exports: {
      async queryWindowsProcessSnapshot() {
        return { processes: [] };
      }
    }
  };
  delete require.cache[taskStartPreflightPath];
  const { assertControlCenterTaskCanStart } = require("../../src/controlCenter/taskService/taskStartPreflight");

  try {
    await assert.rejects(
      () => assertControlCenterTaskCanStart("start", "D:\\桌面\\办公软件\\1.客服超时督办"),
      /Edge 目录正在使用/
    );
  } finally {
    if (originalGuardCache) {
      require.cache[browserGuardPath] = originalGuardCache;
    } else {
      delete require.cache[browserGuardPath];
    }
    if (originalSnapshotCache) {
      require.cache[windowsSnapshotPath] = originalSnapshotCache;
    } else {
      delete require.cache[windowsSnapshotPath];
    }
    if (originalPreflightCache) {
      require.cache[taskStartPreflightPath] = originalPreflightCache;
    } else {
      delete require.cache[taskStartPreflightPath];
    }
  }
});
