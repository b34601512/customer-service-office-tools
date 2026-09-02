const fs = require("fs");
const appConfig = require("../../config/appConfig");
const { movePathToBackup } = require("../fileSystem");

function readManagedPid(pidPath) {
  // 这个函数只读取并校验一个托管进程 PID 文件。
  if (!fs.existsSync(pidPath)) {
    return 0;
  }
  const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function writeManagedPid(pidPath, pid) {
  // 这个函数只把一个托管进程 PID 写入状态文件。
  fs.writeFileSync(pidPath, String(pid), "utf8");
}

function clearManagedPid(pidPath) {
  // 这个函数只把已失效的 PID 状态文件迁移到备份目录。
  if (fs.existsSync(pidPath)) {
    movePathToBackup(pidPath, appConfig.backupRootDir, "进程状态");
  }
}

module.exports = {
  readManagedPid,
  writeManagedPid,
  clearManagedPid
};
