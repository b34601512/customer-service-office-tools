// 本文件是提醒文案真源（纯函数）：事件 + 值班@计划 → 企微文本。界面不参与文案拼装。
// 文案规则（用户定）：说清 平台·店铺缩写 + 什么分类要处理；不发链接；附当日值班与底色说明。

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 工单列表 → “订单号（纠纷单号）”行，最多列 5 单防刷屏。
function ticketLines(tickets, prefix = "　") {
  const list = tickets || [];
  const shown = list.slice(0, 5).map((tk) => {
    const order = tk.orderId ? `订单 ${tk.orderId}` : `单号 ${tk.id}`;
    return tk.ticketId && tk.orderId ? `${prefix}${order}（纠纷单 ${tk.ticketId}）` : `${prefix}${order}`;
  });
  if (list.length > 5) shown.push(`${prefix}…等共 ${list.length} 单`);
  return shown;
}

function dutyLinesOf(mentionPlan) {
  if (!mentionPlan) return [];
  const lines = [];
  if (mentionPlan.todayLine) lines.push(mentionPlan.todayLine);
  if (mentionPlan.onDutyLine) lines.push(mentionPlan.onDutyLine);
  return lines;
}

function buildAlertMessage(event, mentionPlan = null) {
  const { meta } = event;
  const header = `【工单提醒】${meta.platformName}·${meta.storeName} ${meta.sourceName}`;
  const dutyLines = dutyLinesOf(mentionPlan);

  if (event.type === "login_required") {
    return `${header}\n店铺登录态已失效，后台工单无法检查，请尽快在监控电脑上重新登录京麦。\n时间：${formatTime(event.at)}${dutyLines.length ? `\n${dutyLines.join("\n")}` : ""}`;
  }
  if (event.type === "login_restored") {
    return `${header}\n店铺登录已恢复，工单监控继续。\n时间：${formatTime(event.at)}`;
  }
  if (event.type === "pending_repeat") {
    const summary = Object.entries(event.counts || {})
      .filter(([, c]) => c > 0)
      .map(([label, c]) => `${label} ${c} 单`)
      .join("，");
    return `${header}\n仍有未处理工单：${summary}，请及时处理。\n时间：${formatTime(event.at)}${dutyLines.length ? `\n${dutyLines.join("\n")}` : ""}`;
  }

  // 判责结果已出：补报一次，不再重发
  if (event.type === "verdict_decided") {
    const lines = (event.tickets || []).flatMap((tk) => [
      ...ticketLines([tk], "· "),
      `　判责结果：${tk.verdict || "已出"}`
    ]);
    return `${header}\n【${event.label}】判责结果已出：\n${lines.join("\n")}\n时间：${formatTime(event.at)}`;
  }
  // 判责未出：按配置间隔持续催办
  if (event.type === "verdict_pending") {
    return `${header}\n【${event.label}】以下工单判责结果仍未出，请跟进：\n${ticketLines(event.tickets, "· ").join("\n")}\n时间：${formatTime(event.at)}`;
  }

  // count_increase：变化行下附新增单订单号
  const lines = (event.changes || []).flatMap((c) => {
    const head = `· ${c.label}：新增 ${c.newItems} 单（${c.from} → ${c.to}）`;
    const tkLines = c.tickets ? ticketLines(c.tickets) : [];
    return [head, ...tkLines];
  });
  return `${header}\n${lines.join("\n")}\n时间：${formatTime(event.at)}${dutyLines.length ? `\n${dutyLines.join("\n")}` : ""}`;
}

module.exports = { buildAlertMessage, formatTime, ticketLines };
