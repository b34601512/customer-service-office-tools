// 该文件用于格式化未实质回复监控里的消息时间，避免看板重复实现。
function formatMessageTime(timestampMs) {
  // 这里把客户最后消息时间转成人能看懂的时间，过程看板直接展示。
  const numericTimestamp = Number(timestampMs);
  if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) {
    return "";
  }

  return new Date(numericTimestamp).toLocaleString("zh-CN", { hour12: false });
}

module.exports = {
  formatMessageTime
};
