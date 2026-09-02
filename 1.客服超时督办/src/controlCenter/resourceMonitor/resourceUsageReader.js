const { DEFAULT_SAMPLE_INTERVAL_MS } = require("./constants");
const { normalizePid, normalizePidList } = require("./pid");
const { queryWindowsProcessSnapshot } = require("./windowsProcessSnapshot");
const { buildResourceUsageFromSnapshots } = require("./resourceUsageBuilder");

function waitForSampleInterval(sampleIntervalMs) {
  // CPU 占用只能通过两次采样差值计算，这里的短等待是计算窗口，不是流程兜底等待。
  return new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
}

async function readControlCenterResourceUsage(options = {}) {
  // 该函数对外提供本项目进程树资源占用，接口层只负责返回 JSON。
  const queryProcessSnapshot = options.queryProcessSnapshot || queryWindowsProcessSnapshot;
  const currentPid = normalizePid(options.currentPid) || process.pid;
  const rootPids = normalizePidList([currentPid, ...(options.rootPids || [])]);
  const sampleIntervalMs = Math.max(0, Number(options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS));
  const firstSnapshot = await queryProcessSnapshot();
  if (sampleIntervalMs > 0) {
    await waitForSampleInterval(sampleIntervalMs);
  }
  const secondSnapshot = await queryProcessSnapshot();

  return buildResourceUsageFromSnapshots(firstSnapshot, secondSnapshot, {
    ...options,
    currentPid,
    rootPids
  });
}

module.exports = {
  waitForSampleInterval,
  readControlCenterResourceUsage
};
