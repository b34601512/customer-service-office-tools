const path = require("path");
const appConfig = require("../../config/appConfig");
const { assertBrowserProfileAvailable } = require("../../engine/browserRuntimeGuard");
const { queryWindowsProcessSnapshot } = require("../resourceMonitor/windowsProcessSnapshot");
const { normalizeSearchText } = require("../resourceMonitor/searchText");

function isSupervisionRunCommandLine(commandLine, mainScriptPath) {
  const line = normalizeSearchText(commandLine);
  const script = normalizeSearchText(mainScriptPath);
  if (!line || !script) {
    return false;
  }

  return line.includes(script) && /\brun(?:\s|$)/.test(line);
}

async function assertControlCenterTaskCanStart(taskName, projectRoot) {
  if (taskName === "login" || taskName === "start") {
    assertBrowserProfileAvailable(appConfig.userDataDir);
  }

  if (taskName !== "start") {
    return;
  }

  const mainScriptPath = path.join(projectRoot, "src", "main.js");
  const snapshot = await queryWindowsProcessSnapshot();
  const running = snapshot.processes.filter((processInfo) =>
    isSupervisionRunCommandLine(processInfo.commandLine, mainScriptPath)
  );
  if (running.length === 0) {
    return;
  }

  const pidList = running.map((processInfo) => processInfo.pid).join(", ");
  throw new Error(
    `后台督办已在运行（PID=${pidList}），请勿重复启动。若控制台显示空闲，请打开【6资源】核对进程，或先结束旧进程再启动。`
  );
}

module.exports = {
  assertControlCenterTaskCanStart,
  isSupervisionRunCommandLine
};
