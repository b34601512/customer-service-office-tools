// 该文件用于识别客户已不是联系人导致无法发送消息的终止提示。
const { parseJsonLikeContent, resolveMessageText } = require("../messageNormalization/contentParser");
const { matchesKeywordRules, normalizeText } = require("../replyClassifier");
const { normalizeTimestamp } = require("../messageNormalization/timestampNormalizer");

function resolveMessageUnreachableNoticeText(rawMessage) {
  // 这里从原始消息里提取平台提示正文，因为这类消息会在普通归一化阶段被系统消息过滤掉。
  const content = parseJsonLikeContent(rawMessage?.content);
  return normalizeText(resolveMessageText(rawMessage, content));
}

function isUnreachableContactNoticeText(text, replyConfig) {
  // 这里用配置关键词识别“已不是联系人/需要发送验证”的平台拦截提示，避免把旧客户消息误判为漏回复。
  return matchesKeywordRules(
    text,
    replyConfig?.missedReplyUnreachableContactKeywords || [],
    "platformNotice"
  );
}

function findLatestUnreachableContactNotice(rawMessages, replyConfig) {
  // 这里只返回最新一条无法联系提示，后续用时间判断它是否发生在客户消息之后。
  let latestNotice = null;
  for (const rawMessage of Array.isArray(rawMessages) ? rawMessages : []) {
    const text = resolveMessageUnreachableNoticeText(rawMessage);
    if (!text || !isUnreachableContactNoticeText(text, replyConfig)) {
      continue;
    }

    const timestampMs = normalizeTimestamp(
      rawMessage?.timestamp || rawMessage?.createdAt || rawMessage?.createTime || rawMessage?.sendTime || rawMessage?.time
    );
    if (timestampMs <= 0) {
      continue;
    }

    if (!latestNotice || timestampMs > latestNotice.timestampMs) {
      latestNotice = {
        timestampMs,
        text
      };
    }
  }

  return latestNotice;
}

function isUnreachableContactNoticeAfterMessage(notice, message) {
  // 这里要求提示发生在待处理客户消息之后，避免历史删好友提示压住客户后续重新发来的新消息。
  return Boolean(notice?.timestampMs > 0 && message?.timestampMs > 0 && notice.timestampMs >= message.timestampMs);
}

module.exports = {
  findLatestUnreachableContactNotice,
  isUnreachableContactNoticeAfterMessage,
  isUnreachableContactNoticeText
};
