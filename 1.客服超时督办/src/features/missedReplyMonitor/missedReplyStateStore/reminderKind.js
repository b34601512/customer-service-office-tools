// 该文件用于收口漏回复提醒类型枚举。
function normalizeReminderKind(value) {
  // 这里把提醒类型收口成两段式枚举，状态层不接收其他字符串。
  const normalizedValue = String(value || "").trim();
  if (normalizedValue === "timeout" || normalizedValue === "missedReply") {
    return normalizedValue;
  }

  return "";
}

module.exports = {
  normalizeReminderKind
};
