// 读取页面里的真实店铺身份，防止多店运行时串店写入汇总表。

function normalizeIdentityText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitIdentityKeywords(value) {
  return String(value || "")
    .split(/[,\n|，、；;]+/)
    .map(normalizeIdentityText)
    .filter(Boolean);
}

function dedupeTexts(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeIdentityText(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function resolveExpectedPddIdentityTokens(storeConfig = {}) {
  const explicitValues = [
    ...(Array.isArray(storeConfig.expectedIdentityTexts) ? storeConfig.expectedIdentityTexts : []),
    storeConfig.expectedIdentityText,
    storeConfig.expectedStoreIdentityText,
    storeConfig.storeIdentityText
  ].flatMap(splitIdentityKeywords);
  if (explicitValues.length) return dedupeTexts(explicitValues);

  const usernameStoreName = normalizeIdentityText(String(storeConfig.username || "").split(/[:：]/)[0]);
  if (usernameStoreName) return [usernameStoreName];

  const displayName = normalizeIdentityText(storeConfig.displayName || storeConfig.key);
  return dedupeTexts(displayName.match(/[A-Za-z0-9]{3,}/g) || []);
}

function buildPddStoreIdentityStatus(pageText, storeConfig = {}) {
  const normalizedPageText = normalizeIdentityText(pageText);
  const expectedTokens = resolveExpectedPddIdentityTokens(storeConfig);
  const matchedToken = expectedTokens.find((token) => normalizedPageText.includes(token)) || "";
  return {
    expectedIdentityText: expectedTokens.join(" / "),
    identityMatched: Boolean(matchedToken),
    matchedIdentityText: matchedToken,
    storeIdentityText: normalizedPageText.slice(0, 160)
  };
}

function isPddStoreIdentityMatched(pageText, storeConfig = {}) {
  return buildPddStoreIdentityStatus(pageText, storeConfig).identityMatched;
}

function buildPddIdentityMismatchMessage(identityStatus, storeConfig = {}) {
  const storeName = normalizeIdentityText(storeConfig.displayName || storeConfig.key || "当前店铺");
  const expectedText = normalizeIdentityText(identityStatus.expectedIdentityText);
  if (!expectedText) {
    return `当前拼多多店铺「${storeName}」缺少真实店铺身份关键词，请在配置中补充账号。`;
  }
  return `当前拼多多页面真实店铺身份不匹配：期望「${expectedText}」，页面未命中；请先打开「${storeName}」对应账号窗口。`;
}

async function assertPddStoreIdentityMatches(page, storeConfig = {}) {
  const pageText = await page.locator("body").innerText();
  const identityStatus = buildPddStoreIdentityStatus(pageText, storeConfig);
  if (!identityStatus.identityMatched) {
    throw new Error(buildPddIdentityMismatchMessage(identityStatus, storeConfig));
  }
  return identityStatus;
}

module.exports = {
  resolveExpectedPddIdentityTokens,
  buildPddStoreIdentityStatus,
  isPddStoreIdentityMatched,
  assertPddStoreIdentityMatches
};
