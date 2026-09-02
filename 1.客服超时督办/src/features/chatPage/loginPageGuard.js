// 该文件用于识别登录页并抛出明确登录失效错误。
const { log } = require("../../engine/logger");
const { LOGIN_PAGE_KEYWORD_GROUPS } = require("./loginKeywordGroups");
const { normalizeBodyText, readBodyText } = require("./bodyText");

function resolveLoginPageReason(bodyText) {
  // 这里统一识别登录页正文特征，避免把登录问题误报成聊天工作台超时。
  const normalizedText = normalizeBodyText(bodyText);

  for (const keywords of LOGIN_PAGE_KEYWORD_GROUPS) {
    if (keywords.every((keyword) => normalizedText.includes(keyword))) {
      return `当前登录态已失效，请点击控制台里的「首次登录」重新登录。命中特征：${keywords.join("、")}`;
    }
  }

  return "";
}

async function assertNotLoginPage(page) {
  // 这里在关键节点复核正文，保证一旦落到登录页就立即抛出明确根因。
  const bodyText = await readBodyText(page);
  const loginPageReason = resolveLoginPageReason(bodyText);

  if (loginPageReason) {
    log("主线:失败", "会话页面", "识别登录页", `当前页面命中登录页特征，文本片段：${bodyText.slice(0, 80)}`);
    throw new Error(`${loginPageReason} 当前页面文本片段：${bodyText.slice(0, 300)}`);
  }

  return bodyText;
}

module.exports = {
  resolveLoginPageReason,
  assertNotLoginPage
};
