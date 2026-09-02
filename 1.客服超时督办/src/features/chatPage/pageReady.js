// 该文件用于确认当前页面可以作为聊天工作台继续执行。
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const { waitForReadableBody } = require("../../engine/pageReadiness");
const { assertNotLoginPage } = require("./loginPageGuard");
const { isConversationWorkbenchText } = require("./pageTextClassifier");
const {
  enterChatWorkbenchFromConsole,
  enterConversationListFromNavigation
} = require("./navigation");

const pageReadinessLogStateByPage = new WeakMap();

function shouldLogPageReadinessSnapshot(page, currentUrl, frameUrls) {
  // 这里只在页面结构变化时打印页面与 Frame，避免后台轮询把同一状态刷成噪声。
  const snapshotKey = [currentUrl, ...frameUrls].join("\n");
  if (!page || typeof page !== "object") {
    return true;
  }

  if (pageReadinessLogStateByPage.get(page) === snapshotKey) {
    return false;
  }

  pageReadinessLogStateByPage.set(page, snapshotKey);
  return true;
}

function logPageReadinessSnapshot(page, currentUrl, frameUrls) {
  // 这里保留首次现场和变化现场，重复不变的页面状态不再反复写日志。
  if (!shouldLogPageReadinessSnapshot(page, currentUrl, frameUrls)) {
    return;
  }

  log("主线:执行", "会话页面", "检查页面状态", `当前页面地址：${currentUrl}`);
  log("主线:执行", "会话页面", "检查Frame", `当前 Frame 数量：${frameUrls.length}`);

  for (const [index, frameUrl] of frameUrls.entries()) {
    log("主线:执行", "会话页面", "记录Frame地址", `Frame[${index}] 地址：${frameUrl}`);
  }
}

async function assertChatPageReady(page) {
  // 这里确认当前页面确实是聊天工作台；登录页或企业控制台都不能被误放行。
  await waitForReadableBody(page, appConfig.workbenchReadyTimeout);
  const frames = page.frames();
  const frameUrls = frames.map((frame) => frame.url());
  const currentUrl = page.url();

  logPageReadinessSnapshot(page, currentUrl, frameUrls);

  const bodyText = await assertNotLoginPage(page);
  if (
    currentUrl.includes("/auth/login") ||
    currentUrl.includes("oauth.youzan.com") ||
    frameUrls.some((frameUrl) => frameUrl.includes("oauth.youzan.com"))
  ) {
    throw new Error("当前登录态已失效，请点击控制台里的「首次登录」重新登录。");
  }

  if (isConversationWorkbenchText(bodyText)) {
    return;
  }

  if (await enterChatWorkbenchFromConsole(page, bodyText)) {
    return;
  }

  if (await enterConversationListFromNavigation(page, bodyText)) {
    return;
  }

  throw new Error(`当前页面不是聊天工作台，无法继续后台督办。当前页面文本片段：${bodyText.slice(0, 300)}`);
}

module.exports = {
  assertChatPageReady,
  logPageReadinessSnapshot,
  shouldLogPageReadinessSnapshot
};
