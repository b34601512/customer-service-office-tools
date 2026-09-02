// 该文件用于等待左侧全部菜单切换后会话列表稳定。
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { waitForPageFunction } = require("../../engine/pageWait");
const { readBodyText } = require("./bodyText");

async function waitForAllMenuSelectionReady(page) {
  // 这里在点击「全部」后等待左侧会话区域重新稳定，避免按钮刚点下去就立刻读取旧列表。
  log("主线:执行", "会话页面", "等待全部生效", "开始动态等待左侧「全部」切换完成");
  if (typeof page.evaluate === "function") {
    await page.evaluate(() => {
      delete window.__codexAllMenuStableState;
    }).catch(() => {});
  }

  try {
    await waitForPageFunction(
      page,
      () => {
        const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
        const bodyText = (document.body?.innerText || "").replace(/\s+/g, "");
        // 这里与 pageTextClassifier.isConversationWorkbenchText 互为镜像（序列化函数跨沙箱），改关键词双侧同步（issue #553）。
        const isWorkbenchReady = bodyText.includes("全部对话") && bodyText.includes("账号视图");

        const customerSignature = Array.from(document.querySelectorAll('[id^="chatItem-"]'))
          .map((element) => {
            if (!(element instanceof HTMLElement)) {
              return "";
            }

            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
              return "";
            }

            const text = normalize(element.innerText || element.textContent || "");
            if (!text) {
              return "";
            }

            return `${Math.round(rect.y)}:${text.slice(0, 40)}`;
          })
          .filter(Boolean)
          .join("|");

        const signature = `${isWorkbenchReady ? 1 : 0}|${customerSignature}`;
        const state = window.__codexAllMenuStableState || {
          signature: "",
          stableFrames: 0
        };

        if (signature === state.signature) {
          state.stableFrames += 1;
        } else {
          state.signature = signature;
          state.stableFrames = 0;
        }

        window.__codexAllMenuStableState = state;
        return isWorkbenchReady && state.stableFrames >= 2;
      },
      undefined,
      { timeout: appConfig.workbenchReadyTimeout }
    );
  } catch (error) {
    const bodyText = await readBodyText(page);
    throw new Error(`点击左侧「全部」后页面未稳定，当前页面文本片段：${bodyText.slice(0, 300)}`);
  }

  log("主线:完成", "会话页面", "等待全部生效", "左侧「全部」切换已稳定");
}

module.exports = {
  waitForAllMenuSelectionReady
};
