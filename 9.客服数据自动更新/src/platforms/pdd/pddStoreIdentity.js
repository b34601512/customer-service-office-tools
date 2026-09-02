// 该文件用于解决拼多多页面真实店铺身份读取和配置店铺硬校验问题。
const { readPddPageBodyText } = require("./pddPageText");

function normalizeIdentityText(value) {
  // 把页面和配置里的身份文本统一成可比较格式，避免空格和换行造成误判。
  return String(value || "").replace(/\s+/g, " ").trim();
}

function dedupeTexts(values) {
  // 保留第一次出现的身份关键词，避免同一个关键词重复出现在报错里。
  const seen = new Set();
  return values.filter((value) => {
    const normalizedValue = normalizeIdentityText(value);
    if (!normalizedValue || seen.has(normalizedValue)) {
      return false;
    }
    seen.add(normalizedValue);
    return true;
  });
}

function splitIdentityKeywords(value) {
  // 允许配置用逗号、顿号或竖线写多个真实店铺关键词。
  return String(value || "")
    .split(/[,\n|，、；;]+/)
    .map((item) => normalizeIdentityText(item))
    .filter(Boolean);
}

function resolveExplicitPddIdentityTokens(storeConfig = {}) {
  // 优先使用显式配置的真实店铺身份，后续维护时不用依赖展示名推断。
  const rawTokens = Array.isArray(storeConfig.expectedIdentityTexts)
    ? storeConfig.expectedIdentityTexts
    : Array.isArray(storeConfig.identityKeywords)
      ? storeConfig.identityKeywords
      : [];
  const fromArray = rawTokens.flatMap((item) => splitIdentityKeywords(item));
  const fromText = splitIdentityKeywords(
    storeConfig.expectedIdentityText ||
      storeConfig.expectedStoreIdentityText ||
      storeConfig.storeIdentityText ||
      ""
  );
  return dedupeTexts([...fromArray, ...fromText]);
}

function resolveUsernamePddIdentityTokens(storeConfig = {}) {
  // 拼多多账号常见格式是“店铺名:子账号”，店铺名前半段比展示名更接近真实页面。
  const username = normalizeIdentityText(storeConfig.username);
  if (!username) {
    return [];
  }

  const storeName = normalizeIdentityText(username.split(/[:：]/)[0]);
  return storeName ? [storeName] : [];
}

function resolveDisplayNamePddIdentityTokens(storeConfig = {}) {
  // 没有账号时只从展示名里取足够明确的英文/数字串，避免“德达”这类短词误放行。
  const displayName = normalizeIdentityText(storeConfig.displayName || storeConfig.key);
  const asciiTokens = displayName.match(/[A-Za-z0-9]{3,}/g) || [];
  return dedupeTexts(asciiTokens);
}

function resolveExpectedPddIdentityTokens(storeConfig = {}) {
  // 按“显式配置 > 账号店铺名 > 展示名强特征”的顺序生成硬校验关键词。
  const explicitTokens = resolveExplicitPddIdentityTokens(storeConfig);
  if (explicitTokens.length) {
    return explicitTokens;
  }

  const usernameTokens = resolveUsernamePddIdentityTokens(storeConfig);
  if (usernameTokens.length) {
    return usernameTokens;
  }

  return resolveDisplayNamePddIdentityTokens(storeConfig);
}

function buildPddStoreIdentityStatus(pageText, storeConfig = {}) {
  // 生成一次完整身份判定结果，状态展示、登录确认和下载前校验都复用它。
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
  // 返回当前页面是否属于配置里的拼多多店铺。
  return buildPddStoreIdentityStatus(pageText, storeConfig).identityMatched;
}

async function readPddPageIdentityText(page) {
  // 从真实页面读取身份文本；这里用整页文本是因为拼多多顶部店铺名 DOM 经常变化。
  return normalizeIdentityText(await readPddPageBodyText(page));
}

function buildPddIdentityMismatchMessage(identityStatus, storeConfig = {}) {
  // 把身份不一致说清楚，避免用户只看到“未登录”却不知道串到哪家店。
  const storeName = normalizeIdentityText(storeConfig.displayName || storeConfig.key || "当前店铺");
  const expectedText = normalizeIdentityText(identityStatus.expectedIdentityText);
  if (!expectedText) {
    return `当前拼多多店铺「${storeName}」缺少真实店铺身份关键词，请先在配置里补齐账号或 expectedIdentityText，避免串店写表。`;
  }

  return `当前拼多多页面真实店铺身份不匹配：期望「${expectedText}」，页面未命中；请先打开「${storeName}」对应账号窗口。`;
}

async function assertPddStoreIdentityMatches(page, storeConfig = {}) {
  // 下载和登录确认前必须确认真实店铺身份，防止 pdd02 数据写进 pdd03。
  const pageText = await readPddPageIdentityText(page);
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
  readPddPageIdentityText,
  assertPddStoreIdentityMatches
};
