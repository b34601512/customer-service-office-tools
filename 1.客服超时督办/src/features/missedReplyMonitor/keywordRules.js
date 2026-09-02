const KEYWORD_MATCH_MODES = {
  exact: "exact",
  startsWith: "startsWith",
  includes: "includes"
};

const KEYWORD_MATCH_MODE_LABELS = {
  exact: "完全匹配",
  startsWith: "开头匹配",
  includes: "包含匹配"
};

function normalizeKeywordText(value) {
  // 这里统一清洗关键词文本，避免空格和空值进入漏回复判定。
  return String(value || "").trim();
}

function resolveKeywordMatchMode(value) {
  // 这里只负责识别明确写出的匹配方式，写错时交给上层决定是否报错。
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (["exact", "equals", "equal", "full", "完全匹配", "精确匹配"].includes(normalizedValue)) {
    return KEYWORD_MATCH_MODES.exact;
  }

  if (["startswith", "starts_with", "prefix", "开头匹配", "开头", "前缀"].includes(normalizedValue)) {
    return KEYWORD_MATCH_MODES.startsWith;
  }

  if (["includes", "include", "contains", "contain", "包含匹配", "包含"].includes(normalizedValue)) {
    return KEYWORD_MATCH_MODES.includes;
  }

  return null;
}

function normalizeKeywordMatchMode(value, defaultMode = KEYWORD_MATCH_MODES.exact) {
  // 这里兼容中英文匹配方式写法，让配置文件和网页输入都能读成统一枚举。
  return resolveKeywordMatchMode(value) || defaultMode;
}

function isShortRiskKeyword(text) {
  // 这里识别容易误伤正常回复的短词，默认必须完全匹配。
  const normalizedText = normalizeKeywordText(text).replace(/\s+/g, "");
  return normalizedText.length <= 1 || /^\d+$/.test(normalizedText);
}

function resolveDefaultKeywordMatchMode(category, text) {
  // 这里按关键词类别给默认匹配方式，既方便配置，也避免短词误伤。
  if (isShortRiskKeyword(text)) {
    return KEYWORD_MATCH_MODES.exact;
  }

  if (category === "temporary") {
    return KEYWORD_MATCH_MODES.startsWith;
  }

  return KEYWORD_MATCH_MODES.exact;
}

function resolveKeywordTextFromInput(input) {
  // 这里兼容旧字符串数组和新对象数组，旧配置不需要人工迁移也能继续用。
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return normalizeKeywordText(input);
  }

  return normalizeKeywordText(input.text || input.keyword || input.value || input.label);
}

function normalizeKeywordRule(input, category) {
  // 这里把单个关键词压成“文字 + 匹配方式”，后续判定层只消费一种结构。
  const text = resolveKeywordTextFromInput(input);
  if (!text) {
    return null;
  }

  const defaultMode = resolveDefaultKeywordMatchMode(category, text);
  const rawMode = input && typeof input === "object" && !Array.isArray(input)
    ? input.matchMode || input.mode || input.matchType
    : "";
  return {
    text,
    matchMode: normalizeKeywordMatchMode(rawMode, defaultMode)
  };
}

function normalizeKeywordRules(value, category, defaultValue = []) {
  // 这里统一清洗关键词规则数组，并为没有显式配置匹配方式的关键词补默认值。
  const source = Array.isArray(value) && value.length > 0 ? value : defaultValue;
  return (Array.isArray(source) ? source : [])
    .map((item) => normalizeKeywordRule(item, category))
    .filter(Boolean);
}

module.exports = {
  KEYWORD_MATCH_MODES,
  KEYWORD_MATCH_MODE_LABELS,
  normalizeKeywordRule,
  normalizeKeywordRules,
  resolveKeywordMatchMode
};
