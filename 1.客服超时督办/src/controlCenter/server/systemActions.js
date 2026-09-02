const { spawn } = require("child_process");
const appConfig = require("../../config/appConfig");
const { readLoginStatus } = require("../../features/loginStatusStore");

function openLocalPath(targetPath) {
  // 这里统一调用系统默认程序打开本地文件或目录，保持网页层只发意图不管系统细节。
  spawn("cmd.exe", ["/c", "start", "", targetPath], {
    cwd: appConfig.projectRoot,
    detached: true,
    stdio: "ignore"
  }).unref();
}

function resolveTaskStartRequest(taskName) {
  // 这里把“已登录再点首次登录”转成后台启动，真正登录态仍由后台启动流程二次校验。
  if (taskName !== "login") {
    return {
      taskName,
      message: "任务已启动。"
    };
  }

  const loginStatus = readLoginStatus(appConfig.loginStatusPath);
  if (!loginStatus.isValid) {
    return {
      taskName,
      message: "任务已启动。"
    };
  }

  return {
    taskName: "start",
    message: "当前登录态已验证有效，已直接启动后台督办。"
  };
}

module.exports = {
  openLocalPath,
  resolveTaskStartRequest
};
