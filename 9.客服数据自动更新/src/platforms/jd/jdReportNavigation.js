// 该文件用于解决京东报表页按钮就绪等待问题。
const {
  waitForLocatorActionable: waitForSharedLocatorActionable
} = require("../../shared/browserActionEngine");

async function waitForLocatorActionable(locator, actionName, timeoutMs = 15000) {
  // 这里等按钮真正可点，避免 DOM 出现了但仍在 loading/disabled 状态就继续。
  return waitForSharedLocatorActionable(locator, actionName, { timeoutMs });
}

module.exports = {
  waitForLocatorActionable
};
