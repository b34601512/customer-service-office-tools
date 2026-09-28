const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildOnlinePresenceReminderMessage
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceNotifier");

test("未上线提醒应该按售前/售后分别写清要开启的开关", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["周九", "吴十", "王五"],
    staffGroupByExpectedName: {
      周九: "pre_sales",
      吴十: "pre_sales",
      王五: "after_sales"
    },
    mentionTextByStaffName: {
      周九: "<@userid007>",
      吴十: "<@userid006>",
      王五: "<@userid003>",
      张三: "<@userid001>"
    },
    managerStaffName: "张三"
  });

  assert.equal(
    message,
    [
      "应值班客服尚未上线，请尽快处理：",
      "· 售前（<@userid007> / <@userid006>）：开启「是否可被转接」",
      "· 售后（<@userid003>）：开启「自动分配」",
      "<@userid001>（主管）请督办"
    ].join("\n")
  );
});

test("只有售前未上线时不应把售后写进文案", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["周九"],
    staffGroupByExpectedName: { 周九: "pre_sales" },
    mentionTextByStaffName: { 周九: "周九", 张三: "张三" },
    managerStaffName: "张三"
  });

  assert.equal(
    message,
    [
      "应值班客服尚未上线，请尽快处理：",
      "· 售前（周九）：开启「是否可被转接」",
      "张三（主管）请督办"
    ].join("\n")
  );
});

test("主管也在应值班名单里时不重复督办", () => {
  const message = buildOnlinePresenceReminderMessage({
    expectedStaffNames: ["张三"],
    staffGroupByExpectedName: { 张三: "pre_sales" },
    mentionTextByStaffName: { 张三: "<@userid001>" },
    managerStaffName: "张三"
  });

  assert.equal(
    message,
    ["应值班客服尚未上线，请尽快处理：", "· 售前（<@userid001>）：开启「是否可被转接」"].join("\n")
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
