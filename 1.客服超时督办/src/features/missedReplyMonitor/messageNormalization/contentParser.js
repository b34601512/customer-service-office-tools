function parseJsonLikeContent(rawContent) {
  // 这里把平台 content 统一还原成对象，后续字段读取只面对一种结构。
  if (!rawContent) {
    return {};
  }

  if (typeof rawContent === "object") {
    return rawContent;
  }

  const contentText = String(rawContent || "").trim();
  if (!contentText) {
    return {};
  }

  if (!contentText.startsWith("{") && !contentText.startsWith("[")) {
    return {
      content: contentText
    };
  }

  try {
    return JSON.parse(contentText);
  } catch (error) {
    throw new Error(`漏回复消息 content 不是合法 JSON：${error.message}`);
  }
}

function firstTextValue(values) {
  // 这里从候选字段里取第一段非空文本，避免各消息类型字段名不一致。
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function resolveAttachmentPlaceholder(contentType, content) {
  // 这里给无文字附件补一个可读占位，避免镜像列表出现“无内容”。
  const normalizedContentType = Number(contentType);
  if (normalizedContentType === 6) {
    return "[图片]";
  }
  if (normalizedContentType === 9) {
    return firstTextValue([content?.title, content?.description, "[小程序]"]);
  }
  if ([3, 4, 5, 8, 10, 11, 12, 13, 14, 15].includes(normalizedContentType)) {
    return "[附件]";
  }

  return "";
}

function resolveDirectMessageText(message, content) {
  // 这里只取客户或客服主动输入的正文，不把卡片标题和描述误当成提问。
  const payload = content?.payload && typeof content.payload === "object" ? content.payload : {};
  return firstTextValue([
    message?.text,
    message?.message,
    message?.body,
    content?.text,
    content?.content,
    payload?.text,
    payload?.content
  ]);
}

function resolveMessageText(message, content) {
  // 这里统一提取消息正文，文字优先，附件才补平台占位。
  const payload = content?.payload && typeof content.payload === "object" ? content.payload : {};
  const contentType = Number(content?.type ?? message?.type);
  const directText = resolveDirectMessageText(message, content);
  const titleText = firstTextValue([
    message?.title,
    content?.title,
    content?.description,
    payload?.title,
    payload?.name
  ]);

  return directText || titleText || resolveAttachmentPlaceholder(contentType, content);
}

module.exports = {
  firstTextValue,
  parseJsonLikeContent,
  resolveDirectMessageText,
  resolveMessageText
};
