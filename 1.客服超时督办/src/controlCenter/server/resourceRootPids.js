function resolveResourceRootPids(taskService, getResourceRootPids) {
  // 该函数统一收集控制台、后台任务和受控浏览器 PID，资源接口只统计这些项目根进程。
  const configuredPids = typeof getResourceRootPids === "function" ? getResourceRootPids() : [];
  return [
    process.pid,
    taskService?.currentProcess?.pid,
    ...(Array.isArray(configuredPids) ? configuredPids : [])
  ].filter((pid) => Number.isInteger(Number(pid)) && Number(pid) > 0);
}

module.exports = {
  resolveResourceRootPids
};
