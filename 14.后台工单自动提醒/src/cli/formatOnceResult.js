// 该模块只把 once 巡检结果格式化成终端输出行（纯函数，零业务判断，便于测试）。
// 背景（2026-09-18 实跑）：CLI 过去直接打印 `item.content`，而 service 推入的字段是 `messages`（数组，一单一消息），
// 于是终端只看到 `undefined` —— 字段真源写错就是这个后果。本文件锁死：终端输出必须打真实文案。
function formatOnceResult(result) {
  const lines = [];
  const sent = Array.isArray(result && result.sent) ? result.sent : [];
  for (const item of sent) {
    const 状态 = item.ok ? "已发送" : `发送失败：${item.error || "未知原因"}`;
    lines.push(`--- ${item.event.sourceId} [${item.event.type}] ${状态}`);
    const messages = Array.isArray(item.messages) ? item.messages : [];
    for (const content of messages) {
      lines.push(String(content));
    }
    if (messages.length === 0) {
      // 不许静默：没有文案就明说，别把问题藏起来。
      lines.push("（本次事件没有生成文案，请检查 messageText 真源）");
    }
  }
  if (sent.length === 0) {
    lines.push("本轮没有需要提醒的变化。");
  }
  return lines;
}

module.exports = { formatOnceResult };
