const { spawn } = require("child_process");
const appConfig = require("../../config/appConfig");

function openLocalPath(targetPath) {
  // 这里统一调用系统默认程序打开本地文件或目录，保持网页层只发意图不管系统细节。
  spawn("cmd.exe", ["/c", "start", "", targetPath], {
    cwd: appConfig.projectRoot,
    detached: true,
    stdio: "ignore"
  }).unref();
}

function resolveTaskStartRequest(taskName) {
  // 用户点登录就登录，不能用历史状态把可见登录偷偷改成无头业务执行。
  return { taskName, message: "任务已启动。" };
}

module.exports = {
  openLocalPath,
  resolveTaskStartRequest
};
