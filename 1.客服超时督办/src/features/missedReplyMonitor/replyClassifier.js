const EXPLICIT_SHORT_AGENT_REPLIES = ["嗯", "嗯嗯", "嗯呢"];
const {
  KEYWORD_MATCH_MODES,
  normalizeKeywordRules
} = require("./keywordRules");

function normalizeText(value) {
  // 这里统一清洗消息文本，后续关键词判断只面对一份稳定字符串。
  return String(value || "").trim();
}

function normalizeCompactText(value) {
  // 这里去掉空白，解决“稍 等”“嗯 嗯”这类短文本被格式干扰的问题。
  return normalizeText(value).replace(/\s+/g, "");
}

function stripEdgePunctuation(value) {
  // 这里只去掉边缘标点，保留正文内部内容，避免“稍等。”这类话术识别失败。
  return normalizeCompactText(value).replace(/^[\s,，.。!！?？、;；:：'"“”‘’()（）[\]【】]+|[\s,，.。!！?？、;；:：'"“”‘’()（）[\]【】]+$/g, "");
}

function normalizeClosingCompositionText(value) {
  // 这里去掉弱收尾词之间的标点，解决“好的，谢谢”这类组合收尾被误判为待回复。
  return normalizeCompactText(value).replace(/[\s,，.。!！?？、;；:：'"“”‘’()（）[\]【】…~-]+/g, "");
}

function isPurePunctuation(value) {
  // 这里识别纯标点和纯空白，避免客服随手点一个句号就被当成实质回复。
  const text = normalizeCompactText(value);
  return !text || /^[,，.。!！?？、;；:：'"“”‘’()（）[\]【】…~-]+$/.test(text);
}

function isEmojiOnlyText(value) {
  // 这里把消息整体由一个或多个 [表情]/【表情】占位符组成的情况视为纯表情，避免表情组合刷掉漏回复提醒。
  const text = normalizeCompactText(value);
  if (!text) {
    return false;
  }

  return /^(\[[^\[\]]{1,10}\]|【[^【】]{1,10}】)+$/.test(text);
}

function matchesKeywordRule(text, rule) {
  // 这里按单个关键词自己的匹配方式判断，避免全局规则误伤短词。
  const normalizedText = stripEdgePunctuation(text);
  const normalizedKeyword = normalizeCompactText(rule?.text);
  if (!normalizedText || !normalizedKeyword) {
    return false;
  }

  if (rule.matchMode === KEYWORD_MATCH_MODES.includes) {
    return normalizedText.includes(normalizedKeyword);
  }

  if (rule.matchMode === KEYWORD_MATCH_MODES.startsWith) {
    return normalizedText.startsWith(normalizedKeyword);
  }

  return normalizedText === normalizedKeyword;
}

function matchesKeywordRules(text, keywords, category) {
  // 这里统一执行一组关键词规则，规则缺省时按类别补默认匹配方式。
  return normalizeKeywordRules(keywords, category).some((rule) => matchesKeywordRule(text, rule));
}

function matchesExactKeyword(text, keywords) {
  // 这里保留旧函数名给明确短答复使用，本质是强制完全匹配。
  return normalizeKeywordRules(keywords, "closing")
    .map((rule) => ({ ...rule, matchMode: KEYWORD_MATCH_MODES.exact }))
    .some((rule) => matchesKeywordRule(text, rule));
}

function canSplitIntoClosingKeywords(text, keywords) {
  // 这里判断整句话能否完全拆成多个弱收尾词，避免只补单个组合词导致规则越来越臃肿。
  const normalizedText = normalizeClosingCompositionText(text);
  const normalizedKeywords = Array.from(new Set(
    normalizeKeywordRules(keywords, "closing")
      .filter((rule) => rule.matchMode === KEYWORD_MATCH_MODES.exact)
      .map((rule) => normalizeClosingCompositionText(rule.text))
      .filter(Boolean)
  )).sort((left, right) => right.length - left.length);
  if (!normalizedText || normalizedKeywords.length === 0) {
    return false;
  }

  const reachableIndexes = Array(normalizedText.length + 1).fill(false);
  reachableIndexes[0] = true;
  for (let index = 0; index < normalizedText.length; index += 1) {
    if (!reachableIndexes[index]) {
      continue;
    }

    for (const keyword of normalizedKeywords) {
      if (normalizedText.startsWith(keyword, index)) {
        reachableIndexes[index + keyword.length] = true;
      }
    }
  }

  return reachableIndexes[normalizedText.length];
}

function matchesTemporaryReply(text, keywords) {
  // 这里识别“稍等类”临时话术，每个关键词可以独立决定完全、开头或包含匹配。
  return matchesKeywordRules(text, keywords, "temporary");
}

function isCustomerClosingMessage(message, replyConfig) {
  // 这里判断客户最后一条是不是弱收尾，弱收尾不单独触发漏回复。
  return (
    matchesKeywordRules(message?.text, replyConfig.missedReplyCustomerClosingKeywords, "closing") ||
    canSplitIntoClosingKeywords(message?.text, replyConfig.missedReplyCustomerClosingKeywords)
  );
}

function isCustomerResolutionMessage(message, replyConfig) {
  // 客户明确表示问题已经解决时，关闭现有待回复责任；这与“谢谢/好的”弱收尾不是同一语义。
  return matchesKeywordRules(
    message?.text,
    replyConfig.missedReplyCustomerResolutionKeywords,
    "resolution"
  );
}

function classifyAgentReply(message, replyConfig) {
  // 这里把人工消息分成实质回复、临时回复、无效回复三类，主策略只消费分类结果。
  const text = normalizeText(message?.text);
  if (message?.hasAttachment) {
    return {
      kind: "substantive",
      label: "附件实质回复"
    };
  }

  if (matchesExactKeyword(text, EXPLICIT_SHORT_AGENT_REPLIES)) {
    return {
      kind: "substantive",
      label: "明确短答复"
    };
  }

  if (isPurePunctuation(text)) {
    return {
      kind: "invalid",
      label: "空白或标点"
    };
  }

  if (isEmojiOnlyText(text)) {
    // 表情回复（如 [握手]、[OK][抱拳]）视为对客户消息的实质回应，避免道谢/收尾会话被督办。
    return {
      kind: "substantive",
      label: "表情实质回复"
    };
  }

  if (matchesKeywordRules(text, replyConfig.missedReplyInvalidAgentReplyKeywords, "invalid")) {
    return {
      kind: "invalid",
      label: "无效占位回复"
    };
  }

  if (matchesTemporaryReply(text, replyConfig.missedReplyTemporaryReplyKeywords)) {
    return {
      kind: "temporary",
      label: "临时回复"
    };
  }

  if (text) {
    return {
      kind: "substantive",
      label: "人工实质回复"
    };
  }

  return {
    kind: "invalid",
    label: "空消息"
  };
}

module.exports = {
  classifyAgentReply,
  isCustomerClosingMessage,
  isCustomerResolutionMessage,
  isEmojiOnlyText,
  isPurePunctuation,
  matchesExactKeyword,
  matchesKeywordRule,
  matchesKeywordRules,
  matchesTemporaryReply,
  normalizeText,
  stripEdgePunctuation
};
