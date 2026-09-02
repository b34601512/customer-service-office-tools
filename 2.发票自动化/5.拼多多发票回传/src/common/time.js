function 格式化时间(时间 = new Date()) {
  // 解决：日志需要稳定的人类可读时间，方便按运行过程回看。
  const pad = (value) => String(value).padStart(2, '0');
  return `${时间.getFullYear()}-${pad(时间.getMonth() + 1)}-${pad(时间.getDate())} ${pad(时间.getHours())}:${pad(时间.getMinutes())}:${pad(时间.getSeconds())}`;
}

module.exports = {
  格式化时间,
};
