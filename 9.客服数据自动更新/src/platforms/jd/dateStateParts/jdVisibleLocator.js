async function pickVisibleJdLocator(locator) {
  // 这个函数只按页面顺序返回第一个可见京东元素。
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) {
      return candidate;
    }
  }
  return null;
}

module.exports = {
  pickVisibleJdLocator
};
