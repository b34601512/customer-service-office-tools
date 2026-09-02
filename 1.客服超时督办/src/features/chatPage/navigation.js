// 该文件用于从企业控制台或导航壳切入聚合聊天工作台。
const appConfig = require("../../config/appConfig");
const { log } = require("../../engine/logger");
const {
  isEnterpriseConsoleText,
  isChatWorkbenchNavigationText
} = require("./pageTextClassifier");
const { waitForWorkbench } = require("./workbenchWait");

async function enterChatWorkbenchFromConsole(page, bodyText) {
  // 这里处理登录成功后落在企业控制台的情况，主动点击「聊天工作台」进入业务页面。
  if (!isEnterpriseConsoleText(bodyText)) {
    return false;
  }

  log("主线:执行", "会话页面", "切入聊天工作台", "当前停在企业控制台，准备点击「聊天工作台」");
  const chatWorkbenchEntry = page.getByText(/^聊天工作台$/, { exact: true }).first();
  await chatWorkbenchEntry.waitFor({
    state: "visible",
    timeout: appConfig.pageReadyTimeout
  });
  await chatWorkbenchEntry.click();
  await waitForWorkbench(page);
  log("主线:完成", "会话页面", "切入聊天工作台", `已进入聊天工作台，当前地址：${page.url()}`);
  return true;
}

async function enterConversationListFromNavigation(page, bodyText) {
  // 这里处理后台启动已经登录但停在聊天工作台导航页的情况，主动进入聚合聊天列表。
  if (!isChatWorkbenchNavigationText(bodyText)) {
    return false;
  }

  log("主线:执行", "会话页面", "切入聚合聊天", "当前停在聊天工作台导航页，准备点击「聚合聊天」");
  const aggregateChatEntry = page.getByText(/^聚合聊天$/, { exact: true }).first();
  await aggregateChatEntry.waitFor({
    state: "visible",
    timeout: appConfig.pageReadyTimeout
  });
  await aggregateChatEntry.click();
  await waitForWorkbench(page);
  log("主线:完成", "会话页面", "切入聚合聊天", `已进入聚合聊天会话列表，当前地址：${page.url()}`);
  return true;
}

module.exports = {
  enterChatWorkbenchFromConsole,
  enterConversationListFromNavigation
};
