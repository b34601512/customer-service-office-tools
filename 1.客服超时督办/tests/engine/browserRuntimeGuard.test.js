const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");

function loadBrowserRuntimeGuardWithMockedSpawnSync(mockedSpawnSync) {
  // 这里在加载模块前替换 spawnSync，专门验证 Windows 守卫的边界分支。
  const modulePath = require.resolve("../../src/engine/browserRuntimeGuard");
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = mockedSpawnSync;
  delete require.cache[modulePath];

  try {
    return require("../../src/engine/browserRuntimeGuard");
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    delete require.cache[modulePath];
  }
}

test("taskkill 非零但进程已不存在时不应该误报失败", () => {
  const browserRuntimeGuard = loadBrowserRuntimeGuardWithMockedSpawnSync((command) => {
    if (command === "taskkill.exe") {
      return {
        status: 128,
        stderr: "错误: 没有找到该进程。",
        stdout: ""
      };
    }

    if (command === "powershell.exe") {
      return {
        status: 1,
        stderr: "",
        stdout: ""
      };
    }

    throw new Error(`未预期的命令：${command}`);
  });

  assert.doesNotThrow(() => browserRuntimeGuard.killProcessTree(9527));
});

test("清理项目 Chrome 时应该只结束根进程树，不重复单杀子进程", () => {
  const killedPids = [];
  const browserRuntimeGuard = loadBrowserRuntimeGuardWithMockedSpawnSync((command, args) => {
    if (command === "powershell.exe") {
      return {
        status: 0,
        stderr: "",
        stdout: JSON.stringify([
          {
            ProcessId: 17668,
            ParentProcessId: 4,
            Name: "chrome.exe",
            CommandLine: "chrome.exe --user-data-dir=E:\\Personal\\codex\\客服超时督办\\runtime\\chrome-user-data"
          },
          {
            ProcessId: 37376,
            ParentProcessId: 17668,
            Name: "chrome.exe",
            CommandLine: "chrome.exe --type=gpu-process --user-data-dir=E:\\Personal\\codex\\客服超时督办\\runtime\\chrome-user-data"
          }
        ])
      };
    }

    if (command === "taskkill.exe") {
      killedPids.push(String(args[1]));
      return {
        status: 0,
        stderr: "",
        stdout: ""
      };
    }

    throw new Error(`未预期的命令：${command}`);
  });

  assert.equal(browserRuntimeGuard.killProjectChromeProcesses(), 1);
  assert.deepEqual(killedPids, ["17668"]);
});
