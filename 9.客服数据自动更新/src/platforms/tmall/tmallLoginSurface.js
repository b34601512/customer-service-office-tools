async function findFirstVisibleLocator(frame, selectors) {
  // 这个函数只挑选登录面里第一个可见输入或按钮。
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return locator;
    }
  }
  return null;
}

module.exports = {
  findFirstVisibleLocator
};
