const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const appConfig = require("../../src/config/appConfig");
const { setupIsolatedWecomTestConfig } = require("../support/wecomTestConfig");
const {
  FAILURE_REASON_LABELS,
  buildAutoTransferFailureMessage,
  buildAutoTransferSuccessMessage,
  resolveFailureReasonText,
  resolveReminderKindText,
  sendAutoTransferNotice
} = require("../../src/features/transferMonitor/autoTransferNotifier");

const TEST_WECOM_CONFIG_PATH = setupIsolatedWecomTestConfig("auto-transfer-notifier");

test("转接成功文案说明原接待不在班与改派去向", () => {
  const message = buildAutoTransferSuccessMessage({
    customerName: "高勇【有意 以旧换新】",
    sourceStaffName: "刘秀文",
    targetStaffName: "叶炳辉",
    reminderKindLabel: "首次超时提醒"
  });

  assert.equal(
    message,
    [
      "【超时自动转接】客户已改派",
      "客户：高勇【有意 以旧换新】",
      "原接待：刘秀文（当时不在自己班次内）",
      "已转给：叶炳辉（当班且已上线）",
      "触发：首次超时提醒"
    ].join("\n")
  );
});

test("转接失败文案把机器原因翻成主管看得懂的中文", () => {
  const message = buildAutoTransferFailureMessage({
    customerName: "罗远建【客户】",
    sourceStaffName: "缪婷婷",
    reason: "on_shift_member_offline"
  });

  assert.match(message, /【超时自动转接失败】请主管介入/);
  assert.match(message, /客户：罗远建【客户】/);
  assert.match(message, /原因：当班的客服都没上线（没开接单开关）/);
  assert.equal(resolveFailureReasonText("no_open_app_socket"), FAILURE_REASON_LABELS.no_open_app_socket);
  assert.equal(resolveFailureReasonText("从未见过的原因"), "从未见过的原因");
});

test("提醒类型文案与主链路一致", () => {
  assert.equal(resolveReminderKindText("missedReply"), "漏回复提醒");
  assert.equal(resolveReminderKindText("timeout"), "首次超时提醒");
  assert.equal(resolveReminderKindText("shiftHandover"), "交班补判");
});

test("原接待在班但没上线时，通知要说明是“没上线”而不是“不在班”", () => {
  const successMessage = buildAutoTransferSuccessMessage({
    customerName: "客户甲",
    sourceStaffName: "柯紫婷",
    targetStaffName: "缪婷婷",
    sourceAvailabilityLabel: "当时在班但没上线（没开接单开关）"
  });
  assert.match(successMessage, /原接待：柯紫婷（当时在班但没上线（没开接单开关））/);
  assert.match(successMessage, /已转给：缪婷婷（当班且已上线）/);

  const failureMessage = buildAutoTransferFailureMessage({
    customerName: "客户甲",
    sourceStaffName: "柯紫婷",
    sourceAvailabilityLabel: "当时在班但没上线（没开接单开关）",
    reason: "on_shift_member_offline"
  });
  assert.match(failureMessage, /原接待：柯紫婷（当时在班但没上线（没开接单开关））/);
});

test("失败通知必须@主管，成功通知只留痕不打扰", async () => {
  const sentBodies = [];
  const originalFetch = global.fetch;
  fs.writeFileSync(TEST_WECOM_CONFIG_PATH, JSON.stringify({
    notification_groups: [
      {
        id: "group_all_staff",
        name: "小程序商城&客服对接群",
        webhook_url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key",
        enabled: true
      }
    ],
    member_directory: [
      { name: "黎路遥", mobile: "19900000000", user_id: "", inline_mention_enabled: true }
    ]
  }));

  try {
    global.fetch = async (url, options) => {
      sentBodies.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async json() {
          return { errcode: 0, errmsg: "ok" };
        }
      };
    };

    const failureResult = await sendAutoTransferNotice({
      outcome: "failed",
      customerName: "客户甲",
      sourceStaffName: "缪婷婷",
      reason: "on_shift_member_offline"
    });
    const successResult = await sendAutoTransferNotice({
      outcome: "succeeded",
      customerName: "客户乙",
      sourceStaffName: "刘秀文",
      targetStaffName: "叶炳辉"
    });

    assert.equal(failureResult.mentionedMobileCount, 1);
    assert.equal(successResult.mentionedMobileCount, 0);
    assert.equal(sentBodies.length, 2);
    assert.deepEqual(sentBodies[0].body.text.mentioned_mobile_list, ["19900000000"]);
    assert.deepEqual(sentBodies[1].body.text.mentioned_mobile_list, []);
    assert.match(sentBodies[0].body.text.content, /超时自动转接失败/);
    assert.match(sentBodies[1].body.text.content, /已转给：叶炳辉/);
  } finally {
    global.fetch = originalFetch;
  }
});
