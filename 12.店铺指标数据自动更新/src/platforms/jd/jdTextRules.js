function normalizeText(value) {
  // 这里统一清理页面文字，供京东系统页面的精确文本匹配共用。
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickBestVisibleTextCandidateIndex(candidateTexts, expectedText) {
  // 这里仅接受完整文本相等的候选节点，避免相似菜单项被误点。
  const normalizedExpected = normalizeText(expectedText);
  return (candidateTexts || []).findIndex((candidateText) => normalizeText(candidateText) === normalizedExpected);
}

module.exports = { normalizeText, pickBestVisibleTextCandidateIndex };
