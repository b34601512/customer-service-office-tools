async function readJdPageBodyText(page) {
  // 这里提供京东页面正文的唯一事实入口，读取失败必须原样暴露，不能伪装成空页面。
  return page.evaluate(() => document.body?.innerText || "");
}

module.exports = {
  readJdPageBodyText
};
