const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildResourceUsageFromSnapshots,
  collectProjectProcessPids,
  formatBytes,
  normalizePidList
} = require("../../src/controlCenter/controlCenterResourceMonitor");

function processRecord(input) {
  // 这里构造资源采集快照，避免测试依赖真实 Windows 进程列表。
  return {
    pid: input.pid,
    parentPid: input.parentPid || 0,
    name: input.name || "node.exe",
    commandLine: input.commandLine || "",
    workingSetBytes: input.workingSetBytes || 0,
    totalCpuTime100ns: input.totalCpuTime100ns || 0
  };
}

test("资源统计应该只纳入项目根进程、子进程和项目路径进程", () => {
  const processes = [
    processRecord({ pid: 100, commandLine: "node src\\controlCenter\\startControlCenter.js" }),
    processRecord({ pid: 101, parentPid: 100, name: "chrome.exe" }),
    processRecord({ pid: 102, parentPid: 101, name: "chrome.exe" }),
    processRecord({ pid: 300, commandLine: "node D:\\project\\src\\main.js run" }),
    processRecord({
      pid: 400,
      parentPid: 100,
      name: "powershell.exe",
      commandLine: "powershell.exe -NoProfile -Command Get-CimInstance Win32_Process | ConvertTo-Json -Compress"
    }),
    processRecord({ pid: 999, commandLine: "node D:\\other\\tool.js" })
  ];

  const includedPids = collectProjectProcessPids(processes, [100], {
    projectRoot: "D:\\project",
    controlCenterUserDataDir: "D:\\project\\runtime\\control-center-browser"
  });

  assert.deepEqual([...includedPids].sort((left, right) => left - right), [100, 101, 102, 300]);
});

test("资源统计应该用两次采样差值计算 CPU 并汇总内存", () => {
  const firstSnapshot = {
    capturedAtMs: 1000,
    processes: [
      processRecord({
        pid: 100,
        name: "node.exe",
        commandLine: "node D:\\project\\src\\controlCenter\\startControlCenter.js",
        workingSetBytes: 100 * 1024 * 1024,
        totalCpuTime100ns: 10 * 10000000
      }),
      processRecord({
        pid: 101,
        parentPid: 100,
        name: "chrome.exe",
        workingSetBytes: 200 * 1024 * 1024,
        totalCpuTime100ns: 5 * 10000000
      })
    ]
  };
  const secondSnapshot = {
    capturedAtMs: 2000,
    processes: [
      processRecord({
        pid: 100,
        name: "node.exe",
        commandLine: "node D:\\project\\src\\controlCenter\\startControlCenter.js",
        workingSetBytes: 120 * 1024 * 1024,
        totalCpuTime100ns: 11 * 10000000
      }),
      processRecord({
        pid: 101,
        parentPid: 100,
        name: "chrome.exe",
        workingSetBytes: 210 * 1024 * 1024,
        totalCpuTime100ns: 5.5 * 10000000
      }),
      processRecord({
        pid: 999,
        name: "node.exe",
        commandLine: "node D:\\other\\tool.js",
        workingSetBytes: 999 * 1024 * 1024,
        totalCpuTime100ns: 99 * 10000000
      })
    ]
  };

  const usage = buildResourceUsageFromSnapshots(firstSnapshot, secondSnapshot, {
    rootPids: [100],
    currentPid: 100,
    logicalCpuCount: 2,
    projectRoot: "D:\\project",
    controlCenterUserDataDir: "D:\\project\\runtime\\control-center-browser"
  });

  assert.equal(usage.cpuPercent, 75);
  assert.equal(usage.memoryWorkingSetBytes, 330 * 1024 * 1024);
  assert.equal(usage.memoryWorkingSetText, "330.0 MB");
  assert.equal(usage.processCount, 2);
  assert.deepEqual(usage.processes.map((item) => item.pid), [101, 100]);
  assert.equal(usage.processes[0].role, "浏览器进程");
  assert.equal(usage.processes[1].role, "控制台后端");
  assert.equal(usage.processGroupCount, 2);
  assert.equal(usage.processGroups[0].role, "浏览器实例");
  assert.equal(usage.processGroups[0].detailText, "chrome.exe｜根 PID 101｜包含 1 个技术进程");
});

test("资源统计列表应该按真实浏览器实例合并 Chrome 子进程", () => {
  const firstSnapshot = {
    capturedAtMs: 1000,
    processes: [
      processRecord({
        pid: 100,
        name: "node.exe",
        commandLine: "node D:\\project\\src\\controlCenter\\startControlCenter.js",
        workingSetBytes: 100 * 1024 * 1024,
        totalCpuTime100ns: 10 * 10000000
      }),
      processRecord({
        pid: 101,
        parentPid: 100,
        name: "chrome.exe",
        commandLine: "chrome.exe --user-data-dir=D:\\project\\runtime\\control-center-browser",
        workingSetBytes: 200 * 1024 * 1024,
        totalCpuTime100ns: 5 * 10000000
      }),
      processRecord({
        pid: 102,
        parentPid: 101,
        name: "chrome.exe",
        workingSetBytes: 90 * 1024 * 1024,
        totalCpuTime100ns: 3 * 10000000
      }),
      processRecord({
        pid: 300,
        name: "node.exe",
        commandLine: "node D:\\project\\src\\main.js run",
        workingSetBytes: 120 * 1024 * 1024,
        totalCpuTime100ns: 6 * 10000000
      }),
      processRecord({
        pid: 301,
        parentPid: 300,
        name: "chrome.exe",
        commandLine: "chrome.exe --user-data-dir=D:\\project\\runtime\\chrome-user-data",
        workingSetBytes: 240 * 1024 * 1024,
        totalCpuTime100ns: 4 * 10000000
      }),
      processRecord({
        pid: 302,
        parentPid: 301,
        name: "chrome.exe",
        workingSetBytes: 160 * 1024 * 1024,
        totalCpuTime100ns: 2 * 10000000
      })
    ]
  };
  const secondSnapshot = {
    capturedAtMs: 2000,
    processes: firstSnapshot.processes.map((item) => ({
      ...item,
      totalCpuTime100ns: item.totalCpuTime100ns + 10000000
    }))
  };

  const usage = buildResourceUsageFromSnapshots(firstSnapshot, secondSnapshot, {
    rootPids: [100, 300],
    currentPid: 100,
    logicalCpuCount: 4,
    projectRoot: "D:\\project",
    controlCenterUserDataDir: "D:\\project\\runtime\\control-center-browser",
    userDataDir: "D:\\project\\runtime\\chrome-user-data"
  });

  assert.equal(usage.processCount, 6);
  assert.equal(usage.processGroupCount, 4);
  assert.deepEqual(
    usage.processGroups.map((item) => [item.role, item.processCount]).sort(),
    [
      ["业务工作台浏览器", 2],
      ["后台督办", 1],
      ["控制台后端", 1],
      ["控制台浏览器", 2]
    ].sort()
  );
  assert.match(
    usage.processGroups.find((item) => item.role === "业务工作台浏览器").detailText,
    /根 PID 301｜包含 2 个技术进程/
  );
});

test("资源统计工具应该清洗 PID 并格式化内存文本", () => {
  assert.deepEqual(normalizePidList([1, "2", 0, "abc", 2]), [1, 2]);
  assert.equal(formatBytes(512), "1 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), "2.00 GB");
});
