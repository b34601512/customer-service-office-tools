const { firstTextValue } = require("./contentParser");

function normalizeObject(value) {
  // 这里只接收普通对象，避免字符串和 null 混进发送人识别。
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeNumber(value) {
  // 这里统一数字字段，无法解析时返回 NaN 让调用方显式判断。
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

function resolveSenderProfile(message, content) {
  // 这里提取平台真实 from/sendBy 字段，这是区分客户、人工和自动回复的主依据。
  const from = normalizeObject(message?.from || content?.from);
  const sendBy = normalizeObject(from.sendBy || message?.sendBy || content?.sendBy);
  const payload = normalizeObject(content?.payload || message?.payload);
  const subPayload = normalizeObject(payload?.subPayload);
  const opUser = normalizeObject(subPayload?.opUser);
  return {
    hasPlatformFrom: Object.keys(from).length > 0,
    isSelf: from.isSelf === true,
    isCoworker: from.coworker === true,
    contactType: normalizeNumber(from.contactType),
    // 公司归属字段：内部人员消息会带“德达集团”这类公司名，外部客户一般为空。
    corporation: firstTextValue([
      from.corporation,
      from.company,
      from.corp,
      message?.corporation
    ]),
    displayName: firstTextValue([
      from.displayName,
      from.name,
      from.nickname,
      message?.senderName,
      message?.fromName,
      message?.userName,
      message?.nickname
    ]),
    sendById: String(sendBy.id || message?.senderUserId || message?.senderId || opUser.userId || opUser.id || "").trim(),
    sendByName: firstTextValue([sendBy.name, sendBy.username, sendBy.nickname, opUser.username, opUser.name]),
    sendBySource: normalizeNumber(sendBy.source)
  };
}

function isChannelLabelName(name) {
  // 企微手机端会把 sendBy.name 写成“来自手机”，这是发送渠道标签而不是客服真实名字。
  return /^(来自手机|来自电脑|来自客户端|来自企微|手机端|电脑端|客户端)$/.test(String(name || "").trim());
}

function resolveSenderName(senderProfile, contact, role) {
  // 这里按已识别角色选择现场最有意义的发送人名称。
  // 客服消息优先用 sendBy.name（真实客服名），仅当它是“来自手机”这类渠道标签时回落 displayName。
  if (role === "agent") {
    const sendByName = senderProfile.sendByName;
    if (isChannelLabelName(sendByName)) {
      return senderProfile.displayName || sendByName;
    }
    return sendByName || senderProfile.displayName;
  }
  if (role === "bot") {
    return senderProfile.sendByName || senderProfile.displayName || "自动回复";
  }
  if (role === "customer") {
    return senderProfile.displayName || String(contact?.customerName || "").trim();
  }

  return senderProfile.sendByName || senderProfile.displayName;
}

module.exports = {
  isChannelLabelName,
  resolveSenderName,
  resolveSenderProfile
};
