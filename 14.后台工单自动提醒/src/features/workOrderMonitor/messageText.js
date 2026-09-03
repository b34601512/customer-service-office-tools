// 本文件是提醒文案真源（纯函数）：事件 + 值班@计划 → 企微文本。界面不参与文案拼装。
// 文案规则（用户定）：只留最少必要内容——店铺缩写（自带平台信息）+ 分类事项 + 订单号；
// 不发：链接、时间戳（企微自带）、平台名前缀、纠纷单号/判责结果明细（那是判断逻辑内部数据）、判责已出的补报（停止重发即完成）。
// 群里值班信息只有一行「本次@：谁（原因）」；完整班次/底色表用 CLI duty 命令看。

function ticketLines(tickets, prefix = "　") {
  const list = tickets || [];
  const shown = list.slice(0, 5).map((tk) => `${prefix}${tk.orderId ? `订单 ${tk.orderId}` : `单号 ${tk.id}`}`);
  if (list.length > 5) shown.push(`${prefix}…等共 ${list.length} 单`);
  return shown;
}

function atLineOf(mentionPlan) {
  if (!mentionPlan || !mentionPlan.onDutyLine) return [];
  return [mentionPlan.onDutyLine];
}

function buildAlertMessage(event, mentionPlan = null) {
  const { meta } = event;
  const header = `【工单提醒】${meta.storeName} ${meta.sourceName}`;
  const tail = atLineOf(mentionPlan);
  const tailText = tail.length ? `\n${tail.join("\n")}` : "";

  if (event.type === "login_required") {
    return `${header}\n店铺登录态已失效，后台工单无法检查，请尽快在监控电脑上重新登录京麦。${tailText}`;
  }
  if (event.type === "login_restored") {
    return `${header}\n店铺登录已恢复，工单监控继续。`;
  }
  if (event.type === "pending_repeat") {
    const summary = Object.entries(event.counts || {})
      .filter(([, c]) => c > 0)
      .map(([label, c]) => `${label} ${c} 单`)
      .join("，");
    return `${header}\n仍有未处理工单：${summary}，请及时处理。${tailText}`;
  }
  if (event.type === "verdict_pending") {
    return `${header}\n【${event.label}】以下工单判责未出，请跟进：\n${ticketLines(event.tickets, "· ").join("\n")}${tailText}`;
  }

  // count_increase：变化行下附新增单订单号。verdict_decided 事件已按用户要求取消（判责出了只是停止重发）。
  const lines = (event.changes || []).flatMap((c) => {
    const head = `· ${c.label}：新增 ${c.newItems} 单（${c.from} → ${c.to}）`;
    const tkLines = c.tickets ? ticketLines(c.tickets) : [];
    return [head, ...tkLines];
  });
  return `${header}\n${lines.join("\n")}${tailText}`;
}

module.exports = { buildAlertMessage, ticketLines };
