const appConfig = require("../config/appConfig");
const { waitForPageFunction } = require("./pageWait");

async function waitForReadableBody(page, timeoutMs = appConfig.pageReadyTimeout) {
  // 这里统一按“正文可读”判断页面是否真的可继续，避免用固定毫秒猜页面什么时候加载完。
  const bodyLocator = page.locator("body");
  await bodyLocator.waitFor({ state: "attached", timeout: timeoutMs });
  await waitForPageFunction(
    page,
    () => {
      if (!document.body) {
        return false;
      }

      const style = window.getComputedStyle(document.body);
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }

      const text = (document.body.innerText || document.body.textContent || "")
        .replace(/\s+/g, "");
      return text.length > 0;
    },
    undefined,
    { timeout: timeoutMs }
  );
}

module.exports = {
  waitForReadableBody
};
