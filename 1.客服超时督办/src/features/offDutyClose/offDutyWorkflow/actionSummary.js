// 该文件用于把下班处理动作汇总成当前状态文案。
function buildActionSummary(actions) {
  // 这里把执行动作翻译成最终状态文案，群提醒和后台记录都统一成“当前状态”口径。
  if (actions.length === 0) {
    return "当前状态：已是关闭态，无需重复操作";
  }

  const statusItems = actions.map((action) => {
    if (action === "关闭自动分配") {
      return "自动分配【已关闭】";
    }

    if (action === "关闭是否可被转接") {
      return "是否可被转接【已关闭】";
    }

    return `${String(action).trim()}【已完成】`;
  });

  return `当前状态：${statusItems.join("；")}`;
}

module.exports = {
  buildActionSummary
};
