const appConfig = require("../../config/appConfig");
const { normalizeSearchText } = require("./searchText");

function isBrowserProcess(processInfo) {
  // 该函数只判断浏览器技术进程，展示层会再按真实浏览器实例合并。
  const processName = normalizeSearchText(processInfo?.name);
  return (
    processName.includes("chrome") ||
    processName.includes("msedge") ||
    processName.includes("chromium") ||
    processName.includes("360se") ||
    processName.includes("qqbrowser")
  );
}

function resolveBrowserProfileDirs(options) {
  // 该函数统一浏览器运行目录口径，让控制台浏览器和业务浏览器能按真实实例分组。
  return {
    controlCenterUserDataDir: normalizeSearchText(
      options.controlCenterUserDataDir || appConfig.controlCenterUserDataDir
    ),
    businessUserDataDirs: [
      options.userDataDir || appConfig.userDataDir,
      ...(
        Array.isArray(options.legacyBrowserDataDirs)
          ? options.legacyBrowserDataDirs
          : appConfig.legacyBrowserDataDirs || []
      )
    ].map(normalizeSearchText).filter(Boolean)
  };
}

function findTopBrowserAncestor(processInfo, processByPid) {
  // 该函数沿父子链找到浏览器根进程，避免把每个 Chrome 子进程误当成一个窗口。
  let currentProcess = processInfo;
  let rootProcess = processInfo;
  const visitedPids = new Set();

  while (currentProcess?.parentPid && processByPid.has(currentProcess.parentPid)) {
    if (visitedPids.has(currentProcess.pid)) {
      break;
    }
    visitedPids.add(currentProcess.pid);

    const parentProcess = processByPid.get(currentProcess.parentPid);
    if (!isBrowserProcess(parentProcess)) {
      break;
    }

    rootProcess = parentProcess;
    currentProcess = parentProcess;
  }

  return rootProcess;
}

function resolveBrowserInstanceRole(browserRootProcess, options) {
  // 该函数根据浏览器独立数据目录判断它到底是控制台窗口还是业务工作台窗口。
  const commandLine = normalizeSearchText(browserRootProcess?.commandLine);
  const profileDirs = resolveBrowserProfileDirs(options);
  if (profileDirs.controlCenterUserDataDir && commandLine.includes(profileDirs.controlCenterUserDataDir)) {
    return "控制台浏览器";
  }
  if (profileDirs.businessUserDataDirs.some((profileDir) => commandLine.includes(profileDir))) {
    return "业务工作台浏览器";
  }

  return "浏览器实例";
}

module.exports = {
  isBrowserProcess,
  resolveBrowserProfileDirs,
  findTopBrowserAncestor,
  resolveBrowserInstanceRole
};
