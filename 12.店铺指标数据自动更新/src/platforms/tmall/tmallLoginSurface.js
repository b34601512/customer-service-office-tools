async function findFirstVisibleLocator(frame, selectors) {
  for (const selector of selectors) {
    const locator = frame.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) {
      return locator;
    }
  }
  return null;
}

module.exports = {
  findFirstVisibleLocator
};
