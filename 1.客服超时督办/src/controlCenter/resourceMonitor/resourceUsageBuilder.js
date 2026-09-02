const os = require("os");
const { WINDOWS_CPU_TIME_UNIT_PER_SECOND } = require("./constants");
const { formatBytes } = require("./byteFormatter");
const { collectProjectProcessPids } = require("./projectProcessFilter");
const { normalizePidList } = require("./pid");
const { resolveProcessRole } = require("./processRole");
const { buildProcessGroups } = require("./processGroupBuilder");

function buildResourceUsageFromSnapshots(firstSnapshot, secondSnapshot, options = {}) {
  // 该函数通过两次快照差值计算 CPU，通过第二次快照统计当前内存。
  const firstProcesses = Array.isArray(firstSnapshot?.processes) ? firstSnapshot.processes : [];
  const secondProcesses = Array.isArray(secondSnapshot?.processes) ? secondSnapshot.processes : [];
  const rootPids = normalizePidList([...(options.rootPids || []), options.currentPid]);
  const includedPids = collectProjectProcessPids(secondProcesses, rootPids, options);
  const firstByPid = new Map(firstProcesses.map((processInfo) => [processInfo.pid, processInfo]));
  const secondByPid = new Map(secondProcesses.map((processInfo) => [processInfo.pid, processInfo]));
  const intervalSeconds = Math.max(0.001, ((secondSnapshot?.capturedAtMs || 0) - (firstSnapshot?.capturedAtMs || 0)) / 1000);
  const logicalCpuCount = Math.max(1, Number(options.logicalCpuCount) || os.cpus().length || 1);

  let totalCpuDelta100ns = 0;
  const includedProcesses = secondProcesses
    .filter((processInfo) => includedPids.has(processInfo.pid))
    .sort((left, right) => left.pid - right.pid);
  const processes = includedProcesses
    .map((processInfo) => {
      const previousProcessInfo = firstByPid.get(processInfo.pid);
      const cpuDelta100ns = previousProcessInfo
        ? Math.max(0, processInfo.totalCpuTime100ns - previousProcessInfo.totalCpuTime100ns)
        : 0;
      totalCpuDelta100ns += cpuDelta100ns;
      const cpuPercent = cpuDelta100ns / WINDOWS_CPU_TIME_UNIT_PER_SECOND / intervalSeconds / logicalCpuCount * 100;
      return {
        pid: processInfo.pid,
        parentPid: processInfo.parentPid,
        name: processInfo.name,
        role: resolveProcessRole(processInfo, options),
        cpuPercent: Number(cpuPercent.toFixed(1)),
        memoryWorkingSetBytes: processInfo.workingSetBytes,
        memoryWorkingSetText: formatBytes(processInfo.workingSetBytes)
      };
    })
    .sort((left, right) => right.memoryWorkingSetBytes - left.memoryWorkingSetBytes);
  const processGroups = buildProcessGroups(includedProcesses, processes, secondByPid, options);

  const memoryWorkingSetBytes = processes.reduce((sum, processInfo) => sum + processInfo.memoryWorkingSetBytes, 0);
  const cpuPercent = totalCpuDelta100ns / WINDOWS_CPU_TIME_UNIT_PER_SECOND / intervalSeconds / logicalCpuCount * 100;

  return {
    capturedAt: new Date(secondSnapshot?.capturedAtMs || Date.now()).toISOString(),
    cpuPercent: Number(Math.max(0, cpuPercent).toFixed(1)),
    memoryWorkingSetBytes,
    memoryWorkingSetText: formatBytes(memoryWorkingSetBytes),
    processCount: processes.length,
    processGroupCount: processGroups.length,
    logicalCpuCount,
    rootPids: [...includedPids].sort((left, right) => left - right),
    processes,
    processGroups
  };
}

module.exports = {
  buildResourceUsageFromSnapshots
};
