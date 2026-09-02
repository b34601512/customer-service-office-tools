const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOnlinePresenceReminderMessage
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceNotifier");

test("无人在线提醒文案应该输出最少必要信息", () => {
  const message = buildOnlinePresenceReminderMessage({
    targetStaffNames: ["黎路遥", "郑兰", "马倩"],
    targetMentionTexts: ["<@liluyao>", "<@miaotingting>", "<@keziting>"],
    expectedStaffNames: ["郑兰", "马倩"]
  });

  assert.equal(
    message,
    [
      "请 <@liluyao> / <@miaotingting> / <@keziting> 尽快上线。",
      "当前应值班客服没有人开启自动分配。",
      "应值班客服：郑兰 / 马倩"
    ].join("\n")
  );
});
