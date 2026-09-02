function 补零(数值) {
  // 解决：统一生成两位数时间片段，避免日志时间格式不稳定。
  return String(数值).padStart(2, '0');
}

function 格式化时间(日期 = new Date()) {
  // 解决：生成和终端日志一致的本地时间字符串。
  return [
    日期.getFullYear(),
    补零(日期.getMonth() + 1),
    补零(日期.getDate()),
  ].join('-') + ' ' + [
    补零(日期.getHours()),
    补零(日期.getMinutes()),
    补零(日期.getSeconds()),
  ].join(':');
}

function 生成时间戳文件名(日期 = new Date()) {
  // 解决：生成可排序的报告文件名，避免跨次运行覆盖。
  return [
    日期.getFullYear(),
    补零(日期.getMonth() + 1),
    补零(日期.getDate()),
    '-',
    补零(日期.getHours()),
    补零(日期.getMinutes()),
    补零(日期.getSeconds()),
  ].join('');
}

module.exports = {
  格式化时间,
  生成时间戳文件名,
};
