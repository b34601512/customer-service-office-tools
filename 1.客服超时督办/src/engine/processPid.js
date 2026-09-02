function normalizeProcessPid(pid) {
  // 这里统一收口 PID，避免空值、字符串和小数混进进程判断。
  const normalizedPid = Number(pid);
  return Number.isInteger(normalizedPid) && normalizedPid > 0 ? normalizedPid : 0;
}

function processExistsByPid(pid) {
  // 这里用 Node 自带的信号 0 只检查进程是否存在，避免每秒拉起 PowerShell。
  const normalizedPid = normalizeProcessPid(pid);
  if (!normalizedPid) {
    return false;
  }

  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

module.exports = {
  normalizeProcessPid,
  processExistsByPid
};
