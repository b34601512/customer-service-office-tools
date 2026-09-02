// 该文件是聊天页共享能力公共入口，具体页面能力拆到 chatPage 目录。
const { assertChatPageReady } = require("./chatPage/pageReady");
const { clickLeftAllMenu } = require("./chatPage/allMenuClick");

module.exports = {
  assertChatPageReady,
  clickLeftAllMenu
};
