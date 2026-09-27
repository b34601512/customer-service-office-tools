const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOnlinePresenceReminderMessage
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceNotifier");

test("未上线提醒应该按售前/售后分别写清要开启的开关", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["韩欢欢", "刘秀文", "缪婷婷"],
    staffGroupByExpectedName: {
      韩欢欢: "pre_sales",
      刘秀文: "pre_sales",
      缪婷婷: "after_sales"
    },
    mentionTextByStaffName: {
      韩欢欢: "<@hanhuanhuan>",
      刘秀文: "<@liuxiuwen>",
      缪婷婷: "<@miaotingting>",
      黎路遥: "<@liluyao>"
    },
    managerStaffName: "黎路遥"
  });

  assert.equal(
    message,
    [
      "应值班客服尚未上线，请尽快处理：",
      "· 售前（<@hanhuanhuan> / <@liuxiuwen>）：开启「是否可被转接」",
      "· 售后（<@miaotingting>）：开启「自动分配」",
      "<@liluyao>（主管）请督办"
    ].join("\n")
  );
});

test("只有售前未上线时不应把售后写进文案", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["韩欢欢"],
    staffGroupByExpectedName: { 韩欢欢: "pre_sales" },
    mentionTextByStaffName: { 韩欢欢: "韩欢欢", 黎路遥: "黎路遥" },
    managerStaffName: "黎路遥"
  });

  assert.equal(
    message,
    [
      "应值班客服尚未上线，请尽快处理：",
      "· 售前（韩欢欢）：开启「是否可被转接」",
      "黎路遥（主管）请督办"
    ].join("\n")
  );
});

test("主管也在应值班名单里时不重复督办", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["黎路遥"],
    staffGroupByExpectedName: { 黎路遥: "pre_sales" },
    mentionTextByStaffName: { 黎路遥: "<@liluyao>" },
    managerStaffName: "黎路遥"
  });

  assert.equal(
    message,
    ["应值班客服尚未上线，请尽快处理：", "· 售前（<@liluyao>）：开启「是否可被转接」"].join("\n")
  );
});

test("缺少分组信息时保底点名不丢人", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["甲"],
    staffGroupByExpectedName: {},
    mentionTextByStaffName: {},
    managerStaffName: ""
  });

  assert.equal(
    message,
    ["应值班客服尚未上线，请尽快处理：", "· 甲：请开启接单开关"].join("\n")
  );
});
