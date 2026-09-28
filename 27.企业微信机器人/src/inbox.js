// 收件记录：把长连接 SDK 的消息帧整理成可落盘的记录（纯函数，便于单测）。
// 设计原则：只记录、不回复；内部 ID 只落本地文件，不打印给用户。

/** 把秒级时间戳转成可读时间；缺省用当前时间。 */
function toLocalTime(createTime) {
  if (!createTime) return new Date().toISOString();
  const ms = createTime < 1e12 ? createTime * 1000 : createTime; // 秒 → 毫秒（兼容已是毫秒的输入）
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 从消息体里提取可读文本（不同 msgtype 结构不同）。 */
function extractText(body) {
  if (!body || typeof body !== "object") return "";
  if (body.text && typeof body.text.content === "string") return body.text.content;
  if (body.voice && typeof body.voice.content === "string") return body.voice.content; // 语音转文本
  if (body.mixed && Array.isArray(body.mixed.items)) {
    const parts = [];
    for (const item of body.mixed.items) {
      if (item && item.text && typeof item.text.content === "string") parts.push(item.text.content);
      if (item && item.image) parts.push("[图片]");
    }
    return parts.join(" ");
  }
  return "";
}

/** 从消息体里提取附件备注（不下载，只记录类型与数量）。 */
function extractNote(body) {
  if (!body || typeof body !== "object") return "";
  if (body.image) return "图片（长连接带下载地址，如需可另存）";
  if (body.file) return `文件：${body.file.name || "未命名"}`;
  if (body.voice && !body.voice.content) return "语音（无转写文本）";
  if (body.quote) return "含引用消息";
  return "";
}

/**
 * 把 SDK 的 WsFrame 整理成收件记录。
 * @param {{body?: object, headers?: object}} frame
 */
function buildRecord(frame) {
  const body = (frame && frame.body) || {};
  const from = body.from || {};
  return {
    at: toLocalTime(body.create_time),
    receivedAt: new Date().toISOString(),
    msgid: body.msgid || (frame && frame.headers && frame.headers.req_id) || "",
    msgtype: body.msgtype || "unknown",
    chattype: body.chattype || "",
    chatid: body.chatid || "",
    fromUserId: from.userid || "",
    text: extractText(body),
    note: extractNote(body)
  };
}

module.exports = { buildRecord, extractText, extractNote, toLocalTime };
