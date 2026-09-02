// 该文件用于识别聊天相关页面正文类型。
const { normalizeBodyText } = require("./bodyText");

function isConversationWorkbenchText(bodyText) {
  // 这里统一判断聊天工作台正文特征，避免多个调用点各写一套条件。
  // 注意：workbenchWait.js 与 allMenuWait.js 的序列化等待函数里有本判定的内联镜像，改关键词需双侧同步（issue #553）。
  const normalizedText = normalizeBodyText(bodyText);
  return normalizedText.includes("全部对话") && normalizedText.includes("账号视图");
}

function isEnterpriseConsoleText(bodyText) {
  // 这里识别登录成功后的企业控制台落点，后续要主动切回真正的聊天工作台。
  const normalizedText = normalizeBodyText(bodyText);
  return (
    normalizedText.includes("企业控制台") &&
    normalizedText.includes("聊天工作台") &&
    (normalizedText.includes("小组控制台") || normalizedText.includes("管理中心"))
  );
}

function isChatWorkbenchNavigationText(bodyText) {
  // 这里识别已登录但停在聊天工作台导航壳的页面，真正会话列表还需要点「聚合聊天」。
  const normalizedText = normalizeBodyText(bodyText);
  return (
    normalizedText.includes("聊天工作台") &&
    normalizedText.includes("聚合聊天") &&
    (normalizedText.includes("聊天历史") || normalizedText.includes("绩效统计"))
  );
}

module.exports = {
  isConversationWorkbenchText,
  isEnterpriseConsoleText,
  isChatWorkbenchNavigationText
};
