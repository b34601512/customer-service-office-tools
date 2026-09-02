const appConfig = require("../../config/appConfig");
const { normalizePidList } = require("./pid");
const { normalizeSearchText } = require("./searchText");

function isProjectCommandLine(processInfo, options) {
  // 该函数补充识别直接带项目路径启动的进程，避免漏掉非父子关系的项目浏览器进程。
  if (isResourceSamplerProcess(processInfo)) {
    return false;
  }

  const commandLine = normalizeSearchText(processInfo.commandLine);
  if (!commandLine) {
    return false;
  }

  const projectRoot = normalizeSearchText(options.projectRoot || appConfig.projectRoot);
  const controlCenterUserDataDir = normalizeSearchText(
    options.controlCenterUserDataDir || appConfig.controlCenterUserDataDir
  );
  return Boolean(
    projectRoot && commandLine.includes(projectRoot) ||
      controlCenterUserDataDir && commandLine.includes(controlCenterUserDataDir)
  );
}

function isResourceSamplerProcess(processInfo) {
  // 资源接口自身会短暂拉起 PowerShell 采样，这个临时进程不属于项目运行占用。
  const processName = normalizeSearchText(processInfo.name);
  const commandLine = normalizeSearchText(processInfo.commandLine);
  return (
    processName.includes("powershell") &&
    commandLine.includes("get-ciminstance win32_process") &&
    commandLine.includes("convertto-json")
  );
}

function collectProjectProcessPids(processes, rootPids, options = {}) {
  // 该函数先锁定项目根进程，再递归纳入子进程，避免把系统其他进程算进来。
  const includedPids = new Set(normalizePidList(rootPids));
  const processList = Array.isArray(processes) ? processes : [];

  processList.forEach((processInfo) => {
    if (isProjectCommandLine(processInfo, options)) {
      includedPids.add(processInfo.pid);
    }
  });

  let changed = true;
  while (changed) {
    changed = false;
    processList.forEach((processInfo) => {
      if (isResourceSamplerProcess(processInfo)) {
        return;
      }
      if (!includedPids.has(processInfo.pid) && includedPids.has(processInfo.parentPid)) {
        includedPids.add(processInfo.pid);
        changed = true;
      }
    });
  }

  processList.forEach((processInfo) => {
    if (isResourceSamplerProcess(processInfo)) {
      includedPids.delete(processInfo.pid);
    }
  });

  return includedPids;
}

module.exports = {
  isProjectCommandLine,
  isResourceSamplerProcess,
  collectProjectProcessPids
};
