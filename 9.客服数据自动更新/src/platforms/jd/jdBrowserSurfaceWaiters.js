const { findVisibleTextLocator, clickVisibleText } = require("./jdVisibleTextLocators");
const { isJdReportSurfaceReady } = require("./jdPopupAndSurfaceState");
const { log } = require("../../engine/logger");

async function findJdReportSurface(browser) {
  // 这里专门识别京东报表操作区，避免靠全文检索“搜索/导出”导致已出现按钮还继续空转。
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const surfaces = [page, ...page.frames()];
      for (const surface of surfaces) {
        if (await isJdReportSurfaceReady(surface)) {
          return { page, surface };
        }
      }
    }
  }

  return null;
}

async function findSurfaceWithVisibleText(browser, textCandidates) {
  // 这里直接找当前可见按钮，不先扫整页文本，确保按钮一出现就能立刻点击。
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const surfaces = [page, ...page.frames()];
      for (const surface of surfaces) {
        for (const text of textCandidates) {
          const locator = await findVisibleTextLocator(surface, text);

          if (locator && (await locator.count()) > 0 && (await locator.isVisible())) {
            return { page, surface, text };
          }
        }
      }
    }
  }

  return null;
}

async function clickFirstVisibleTextInBrowser(browser, textCandidates) {
  // 这里把“找得到就直接点”收口成一个动作，避免先定位页面再重复扫一次。
  const matched = await findSurfaceWithVisibleText(browser, textCandidates);
  if (!matched) {
    return false;
  }

  const clicked = await clickVisibleText(matched.surface, textCandidates);
  if (clicked) {
    log("主线:执行", "京东下载", "直接点击", `已点击「${matched.text}」`);
  }

  return clicked;
}

module.exports = {
  findJdReportSurface,
  findSurfaceWithVisibleText,
  clickFirstVisibleTextInBrowser
};
