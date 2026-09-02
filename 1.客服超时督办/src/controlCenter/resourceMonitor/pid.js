function normalizePid(value) {
  // 该函数统一清洗 PID，避免接口层把空值或字符串误当成进程号。
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function normalizePidList(values) {
  // 该函数把多个来源的 PID 合并成去重列表，保证资源采集范围简单明确。
  const pids = new Set();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const pid = normalizePid(value);
    if (pid) {
      pids.add(pid);
    }
  });
  return [...pids];
}

module.exports = {
  normalizePid,
  normalizePidList
};
