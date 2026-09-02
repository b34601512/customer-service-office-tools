// 该文件用于读取和归一化页面正文。
async function readBodyText(page) {
  // 这里统一读取页面正文，后面要用它判断当前是不是已经进入聊天工作台。
  return page.locator("body").innerText().catch(() => "");
}

function normalizeBodyText(bodyText) {
  // 这里统一压平空白字符，避免换行和空格把关键字匹配打断。
  return String(bodyText || "").replace(/\s+/g, "");
}

module.exports = {
  readBodyText,
  normalizeBodyText
};
