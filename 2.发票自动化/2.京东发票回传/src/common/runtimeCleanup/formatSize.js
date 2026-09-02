function 格式化体积(bytes) {
  // 解决：把字节数转成日志和性能面板容易判断的体积。
  const 数值 = Number(bytes || 0);
  if (数值 >= 1024 * 1024) {
    return `${(数值 / 1024 / 1024).toFixed(1)}MB`;
  }
  return `${(数值 / 1024).toFixed(1)}KB`;
}

module.exports = {
  格式化体积,
};
