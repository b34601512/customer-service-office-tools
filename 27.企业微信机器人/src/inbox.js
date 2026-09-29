// 收件记录：把长连接 SDK 的消息帧整理成可落盘的记录（纯函数，便于单测）。
// 设计原则：只记录、不回复；内部 ID 只落本地文件，不打印给用户。

const path = require("path");

/** 把秒级时间戳转成可读时间；缺省用当前时间。 */
function toLocalTime(createTime) {
  if (!createTime) return new Date().toISOString();
  const ms = createTime < 1e12 ? createTime * 1000 : createTime; // 秒 → 毫秒（兼容已是毫秒的输入）
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 图文混排的子项数组：线上实际字段是 mixed.msg_item，样例/旧版用的是 mixed.items，两者都兼容。 */
function mixedItems(body) {
  if (!body || typeof body !== "object" || !body.mixed) return [];
  const items = body.mixed.msg_item || body.mixed.items;
  return Array.isArray(items) ? items : [];
}

/** 从消息体里提取可读文本（不同 msgtype 结构不同）。 */
function extractText(body) {
  if (!body || typeof body !== "object") return "";
  if (body.text && typeof body.text.content === "string") return body.text.content;
  if (body.voice && typeof body.voice.content === "string") return body.voice.content; // 语音转文本
  if (body.mixed) {
    const parts = [];
    for (const item of mixedItems(body)) {
      if (item && item.text && typeof item.text.content === "string") parts.push(item.text.content);
      if (item && item.image) parts.push("[图片]");
      if (item && item.file) parts.push("[文件]");
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
  if (body.mixed) {
    const kinds = mixedItems(body).map((item) => (item && item.msgtype) || (item && item.image ? "image" : item && item.file ? "file" : ""));
    const label = { text: "文本", image: "图片", file: "文件", voice: "语音", video: "视频" };
    const seen = [...new Set(kinds.filter(Boolean).map((k) => label[k] || k))];
    return `图文混排（${seen.join("+") || "未知"}；长连接带下载地址，如需可另存）`;
  }
  if (body.quote) return "含引用消息";
  return "";
}

function extractMedia(body) {
  if (!body || typeof body !== "object") return null;
  if (body.image && body.image.url) return { kind: "image", url: body.image.url, aeskey: body.image.aeskey || "", name: "" };
  if (body.file && body.file.url) return { kind: "file", url: body.file.url, aeskey: body.file.aeskey || "", name: body.file.name || "" };
  if (body.video && body.video.url) return { kind: "video", url: body.video.url, aeskey: body.video.aeskey || "", name: "" };
  if (body.voice && body.voice.url) return { kind: "voice", url: body.voice.url, aeskey: body.voice.aeskey || "", name: "" };
  if (body.mixed) {
    for (const item of mixedItems(body)) {
      if (item && item.image && item.image.url) return { kind: "image", url: item.image.url, aeskey: item.image.aeskey || "", name: "" };
      if (item && item.file && item.file.url) return { kind: "file", url: item.file.url, aeskey: item.file.aeskey || "", name: item.file.name || "" };
    }
  }
  return null;
}

/** 媒体落盘用的文件名（纯函数，便于单测）：优先用原文件名，否则 msgid + 默认扩展名。 */
function mediaFileName(msgid, media) {
  const fallbackExt = { image: ".jpg", voice: ".amr", video: ".mp4", file: ".bin" };
  const raw = (media && media.name) || "";
  const safe = path.basename(raw).replace(/[\\/:*?"<>|]/g, "_");
  const base = String(msgid || "media") .replace(/[\\/:*?"<>|]/g, "_");
  if (safe && safe.includes(".")) return safe;
  if (safe) return `${safe}-${base}${fallbackExt[(media && media.kind) || "file"] || ".bin"}`;
  return `${base}${fallbackExt[(media && media.kind) || "file"] || ".bin"}`;
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
    note: extractNote(body),
    media: extractMedia(body)
  };
}

module.exports = { buildRecord, extractText, extractNote, extractMedia, mixedItems, mediaFileName, toLocalTime };
