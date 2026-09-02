const { isBrowserProcess, findTopBrowserAncestor, resolveBrowserInstanceRole } = require("./browserProcess");
const { formatBytes } = require("./byteFormatter");

function createProcessGroup(processInfo, processMetric, processByPid, options) {
  // 该函数把一个技术进程归入用户能理解的运行项分组。
  if (isBrowserProcess(processInfo)) {
    const browserRootProcess = findTopBrowserAncestor(processInfo, processByPid);
    const browserRole = resolveBrowserInstanceRole(browserRootProcess, options);
    return {
      key: `browser:${browserRootProcess.pid}`,
      role: browserRole,
      name: browserRootProcess.name,
      pid: browserRootProcess.pid,
      parentPid: browserRootProcess.parentPid,
      type: "browser",
      detailText: "",
      cpuPercent: 0,
      memoryWorkingSetBytes: 0,
      processCount: 0,
      pids: []
    };
  }

  return {
    key: `process:${processInfo.pid}`,
    role: processMetric.role,
    name: processInfo.name,
    pid: processInfo.pid,
    parentPid: processInfo.parentPid,
    type: "process",
    detailText: `${processInfo.name}｜PID ${processInfo.pid}`,
    cpuPercent: 0,
    memoryWorkingSetBytes: 0,
    processCount: 0,
    pids: []
  };
}

function buildProcessGroups(includedProcesses, processMetrics, processByPid, options) {
  // 该函数把技术进程合并成真实运行项，前端默认展示这层而不是展示每个 Chrome 子进程。
  const metricByPid = new Map(processMetrics.map((processMetric) => [processMetric.pid, processMetric]));
  const groupByKey = new Map();

  includedProcesses.forEach((processInfo) => {
    const processMetric = metricByPid.get(processInfo.pid);
    if (!processMetric) {
      return;
    }

    const groupTemplate = createProcessGroup(processInfo, processMetric, processByPid, options);
    const group = groupByKey.get(groupTemplate.key) || groupTemplate;
    group.cpuPercent += Number(processMetric.cpuPercent || 0);
    group.memoryWorkingSetBytes += Number(processMetric.memoryWorkingSetBytes || 0);
    group.processCount += 1;
    group.pids.push(processMetric.pid);
    groupByKey.set(group.key, group);
  });

  return [...groupByKey.values()]
    .map((group) => ({
      ...group,
      cpuPercent: Number(group.cpuPercent.toFixed(1)),
      memoryWorkingSetText: formatBytes(group.memoryWorkingSetBytes),
      detailText: group.type === "browser"
        ? `${group.name}｜根 PID ${group.pid}｜包含 ${group.processCount} 个技术进程`
        : group.detailText,
      pids: group.pids.sort((left, right) => left - right)
    }))
    .sort((left, right) => right.memoryWorkingSetBytes - left.memoryWorkingSetBytes);
}

module.exports = {
  createProcessGroup,
  buildProcessGroups
};
