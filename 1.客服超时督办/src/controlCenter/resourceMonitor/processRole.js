const { normalizePid } = require("./pid");
const { isBrowserProcess } = require("./browserProcess");
const { normalizeSearchText } = require("./searchText");

function resolveProcessRole(processInfo, options) {
  // 该函数把技术进程名转成用户能理解的来源，方便弹窗里快速定位资源来源。
  const currentPid = normalizePid(options.currentPid);
  const commandLine = normalizeSearchText(processInfo.commandLine);
  const processName = String(processInfo.name || "").toLowerCase();

  if (currentPid && processInfo.pid === currentPid) {
    return "控制台后端";
  }
  if (commandLine.includes("src\\main.js run")) {
    return "后台督办";
  }
  if (commandLine.includes("src\\main.js login")) {
    return "首次登录";
  }
  if (commandLine.includes("startcontrolcenter.js")) {
    return "控制台服务";
  }
  if (isBrowserProcess(processInfo)) {
    return "浏览器进程";
  }
  if (processName.includes("node")) {
    return "Node 进程";
  }
  return "项目进程";
}

module.exports = {
  resolveProcessRole
};
