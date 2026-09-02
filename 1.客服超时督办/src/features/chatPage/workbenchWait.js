// 该文件用于等待聊天工作台真正渲染完成。
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { waitForPageFunction } = require("../../engine/pageWait");
const { readBodyText } = require("./bodyText");
const { isConversationWorkbenchText } = require("./pageTextClassifier");
const { assertNotLoginPage } = require("./loginPageGuard");

async function isConversationWorkbenchReady(page) {
  // 这里通过工作台稳定出现的文案判断页面是否已进入会话区域，避免只盯着左侧「全部」一个元素。
  const bodyText = await readBodyText(page);
  return isConversationWorkbenchText(bodyText);
}

async function waitForWorkbench(page) {
  // 这里改成条件驱动等待：页面一旦出现工作台核心文案就立刻继续，不再死等固定秒数。
  log("主线:执行", "会话页面", "等待工作台", "开始动态等待聊天工作台渲染完成");

  try {
    await waitForPageFunction(
      page,
      () => {
        // 这里与 pageTextClassifier.isConversationWorkbenchText 互为镜像（序列化函数跨沙箱），改关键词双侧同步（issue #553）。
        const text = (document.body?.innerText || "").replace(/\s+/g, "");
        return text.includes("全部对话") && text.includes("账号视图");
      },
      undefined,
      { timeout: appConfig.workbenchReadyTimeout }
    );
    log("主线:完成", "会话页面", "等待工作台", "已检测到聊天工作台核心内容");
    return;
  } catch (error) {
    const bodyText = await assertNotLoginPage(page);
    throw new Error(`聊天工作台加载超时，当前页面文本片段：${bodyText.slice(0, 300)}`);
  }
}

module.exports = {
  isConversationWorkbenchReady,
  waitForWorkbench
};
