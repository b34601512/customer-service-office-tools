// 本文件是提醒文案真源（纯函数）：把 alertPolicy 事件转成企微文本，界面不参与文案拼装。

function formatTime(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildAlertMessage(event) {
  const { meta } = event;
  const header = `【工单提醒】${meta.platformName}·${meta.storeName} ${meta.sourceName}`;

  if (event.type === "login_required") {
    return `${header}\n店铺登录态已失效，后台工单无法检查，请尽快在监控电脑上重新登录京麦。\n入口：${meta.url}\n时间：${formatTime(event.at)}`;
  }
  if (event.type === "login_restored") {
    return `${header}\n店铺登录已恢复，工单监控继续。\n时间：${formatTime(event.at)}`;
  }
  if (event.type === "pending_repeat") {
    const summary = Object.entries(event.counts || {})
      .filter(([, c]) => c > 0)
      .map(([label, c]) => `${label} ${c} 单`)
      .join("，");
    return `${header}\n仍有未处理工单：${summary}，请及时处理。\n链接：${meta.url}\n时间：${formatTime(event.at)}`;
  }

  // count_increase
  const lines = (event.changes || []).map(
    (c) => `· ${c.label}：新增 ${c.newItems} 单（${c.from} → ${c.to}）`
  );
  return `${header}\n${lines.join("\n")}\n链接：${meta.url}\n时间：${formatTime(event.at)}`;
}

module.exports = { buildAlertMessage, formatTime };
