const {
  KEYWORD_MATCH_MODE_LABELS,
  normalizeKeywordRule,
  normalizeKeywordRules,
  resolveKeywordMatchMode
} = require("../../features/missedReplyMonitor/keywordRules");

function serializeKeywordRuleListLiteral(items, category) {
  // 这里把关键词规则写成稳定对象数组，避免保存后丢失每个关键词自己的匹配方式。
  const normalizedItems = normalizeKeywordRules(items, category);
  if (normalizedItems.length === 0) {
    return "[]";
  }

  return `[\n    ${normalizedItems
    .map((item) => `{ text: ${JSON.stringify(item.text)}, matchMode: ${JSON.stringify(item.matchMode)} }`)
    .join(",\n    ")}\n  ]`;
}

function findKeywordRuleSeparatorIndex(line) {
  // 这里只支持竖线、中文竖线和制表符做分隔，避免逗号本身作为关键词时被误拆。
  return ["|", "｜", "\t"]
    .map((separator) => line.indexOf(separator))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
}

function normalizeKeywordRuleInputStrict(input, category, fieldLabel, lineNumber) {
  // 这里在保存入口严格校验匹配方式，写错就直接提示，避免静默变成默认规则。
  const rawMatchMode = input && typeof input === "object" && !Array.isArray(input)
    ? input.matchMode || input.mode || input.matchType
    : "";
  if (rawMatchMode && !resolveKeywordMatchMode(rawMatchMode)) {
    const availableLabels = Object.values(KEYWORD_MATCH_MODE_LABELS).join(" / ");
    throw new Error(`${fieldLabel} 第 ${lineNumber} 行匹配方式无效，只能填写：${availableLabels}。`);
  }

  const rule = normalizeKeywordRule(input, category);
  if (!rule) {
    throw new Error(`${fieldLabel} 第 ${lineNumber} 行关键词不能为空。`);
  }

  return rule;
}

function parseKeywordRuleLine(line, category, fieldLabel, lineNumber) {
  // 这里把网页里的一行“关键词 | 匹配方式”转成单条规则，未写匹配方式时使用该类别默认值。
  const rawLine = String(line || "").trim();
  if (!rawLine) {
    return null;
  }

  const separatorIndex = findKeywordRuleSeparatorIndex(rawLine);
  const input = separatorIndex >= 0
    ? {
      text: rawLine.slice(0, separatorIndex).trim(),
      matchMode: rawLine.slice(separatorIndex + 1).trim()
    }
    : rawLine;

  return normalizeKeywordRuleInputStrict(input, category, fieldLabel, lineNumber);
}

function parseKeywordRulesInput(value, fieldLabel, category) {
  // 这里把网页关键词配置转成规则数组，保持一行一个规则，不允许用逗号拆分。
  const normalizedItems = Array.isArray(value)
    ? value.map((item, index) => normalizeKeywordRuleInputStrict(item, category, fieldLabel, index + 1))
    : String(value || "")
      .split(/\r?\n/)
      .map((line, index) => parseKeywordRuleLine(line, category, fieldLabel, index + 1))
      .filter(Boolean);
  if (normalizedItems.length === 0) {
    throw new Error(`${fieldLabel} 至少要填写 1 个关键词。`);
  }

  return normalizedItems;
}

module.exports = {
  serializeKeywordRuleListLiteral,
  parseKeywordRulesInput
};
