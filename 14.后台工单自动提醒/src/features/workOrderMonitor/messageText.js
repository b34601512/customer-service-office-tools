// 本文件是提醒文案真源（纯函数）：事件 + 值班@计划 → 企微文本数组。界面不参与文案拼装。
// 文案规则（用户定）：
// - 最少必要内容：店铺缩写（自带平台信息，不加“京东·”前缀）+ 分类事项 + 订单号；
// - 不发：链接、时间戳（企微自带）、纠纷单号/判责明细（判断逻辑内部数据）、判责已出补报；
// - 一单一消息：一条消息只写一个订单的提醒，不把多单塞进一条；
// - 群里值班信息只有一行「本次@：姓名（原因）」；完整班次/底色表用 CLI duty 命令看。

function ticketOrderText(tk) {
  return tk.orderId ? `订单 ${tk.orderId}` : `单号 ${tk.id}`;
}

function atTail(mentionPlan) {
  if (!mentionPlan || !mentionPlan.onDutyLine) return "";
  return `\n${mentionPlan.onDutyLine}`;
}

// 事件 → 消息数组（发送层逐条发）。count_increase/pending_handling 按单拆开；其余事件单条。
function buildAlertMessages(event, mentionPlan = null) {
  const { meta } = event;
  const header = `【工单提醒】${meta.storeName} ${meta.sourceName}`;
  const tail = atTail(mentionPlan);

  if (event.type === "login_required") {
    return [`${header}\n店铺登录态已失效，后台工单无法检查，请尽快在监控电脑上重新登录京麦。${tail}`];
  }
  if (event.type === "login_restored") {
    return [`${header}\n店铺登录已恢复，工单监控继续。`];
  }
  if (event.type === "pending_repeat") {
    const summary = Object.entries(event.counts || {})
      .filter(([, c]) => c > 0)
      .map(([label, c]) => `${label} ${c} 单`)
      .join("，");
    return [`${header}\n仍有未处理工单：${summary}，请及时处理。${tail}`];
  }
  if (event.type === "pending_handling") {
    return (event.tickets || []).map(
      (tk) => `${header}\n【${event.label}】${ticketOrderText(tk)} 待商家处理，请尽快跟进。${tail}`
    );
  }

  // count_increase：每个新单一条；深读失败没拿到单号时退化为按页签一条。
  const messages = [];
  for (const c of event.changes || []) {
    const head = `· ${c.label}：新增 ${c.newItems} 单（${c.from} → ${c.to}）`;
    if (c.tickets && c.tickets.length > 0) {
      for (const tk of c.tickets) {
        messages.push(`${header}\n${head}\n${ticketOrderText(tk)}${tail}`);
      }
    } else {
      messages.push(`${header}\n${head}${tail}`);
    }
  }
  return messages;
}

module.exports = { buildAlertMessages, ticketOrderText };
