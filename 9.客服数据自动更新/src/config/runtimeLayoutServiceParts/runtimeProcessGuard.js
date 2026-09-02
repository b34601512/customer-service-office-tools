// 该文件用于解决运行目录操作前的受控进程占用判断问题。
const { readManagedPid } = require("../../engine/managedProcessParts/managedPidStore");
const { isProcessRunning } = require("../../engine/managedProcessParts/processQuery");

function isManagedProcessActive(pidPath, sourcePidPath = "", dependencies = {}) {
  // 这个函数只判断 pid 文件对应的进程是否仍在运行。
  const readManagedPidFn = dependencies.readManagedPid || readManagedPid;
  const isProcessRunningFn = dependencies.isProcessRunning || isProcessRunning;
  const currentPid = readManagedPidFn(pidPath);
  if (isProcessRunningFn(currentPid)) {
    return true;
  }

  const sourcePid = sourcePidPath ? readManagedPidFn(sourcePidPath) : 0;
  return isProcessRunningFn(sourcePid);
}

function hasActiveGuardProcess(pidPaths, dependencies = {}) {
  // 这个函数只判断一组守护 pid 中是否有仍在运行的进程。
  return (pidPaths || []).some((pidPath) => isManagedProcessActive(pidPath, "", dependencies));
}

module.exports = {
  isManagedProcessActive,
  hasActiveGuardProcess
};
