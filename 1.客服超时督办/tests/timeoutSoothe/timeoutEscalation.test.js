const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveEscalationTargets,
  resolveEscalationMentionPlan
} = require("../../src/features/timeoutSoothe/timeoutEscalation");

test("运营接待且已配置运营手机号时应该同时@运营和主管", () => {
  const result = resolveEscalationMentionPlan(
    {
      staffName: "",
      staffGroup: "operation"
    },
    {
      memberMobileMap: {
        运营: "13058186211",
        罗淑平: "19539045045",
        黎路遥: "13800000000"
      },
      memberUserIdMap: {},
      memberInlineMentionEnabledMap: {}
    }
  );

  assert.deepEqual(result.mentionedMobileList, ["13058186211", "13800000000"]);
  assert.equal(result.mobileConfigured, true);
  assert.equal(result.managerIncluded, true);
});

test("运营接待但未配置运营手机号时应该只@主管", () => {
  const result = resolveEscalationMentionPlan(
    {
      staffName: "",
      staffGroup: "operation"
    },
    {
      memberMobileMap: {
        黎路遥: "13800000000"
      },
      memberUserIdMap: {},
      memberInlineMentionEnabledMap: {}
    }
  );

  assert.deepEqual(result.mentionedMobileList, ["13800000000"]);
  assert.equal(result.mobileConfigured, false);
  assert.equal(result.managerIncluded, true);
});

test("客服有手机号时应该走底部@并保留主管@", () => {
  const result = resolveEscalationMentionPlan(
    {
      staffName: "苏哲",
      staffGroup: "after_sales"
    },
    {
      memberMobileMap: {
        苏哲: "13800000000",
        黎路遥: "13800000000"
      },
      memberUserIdMap: {
        苏哲: "lishouyao"
      },
      memberInlineMentionEnabledMap: {
        苏哲: true
      }
    }
  );

  assert.deepEqual(result.inlineMentionTokenMap, {});
  assert.deepEqual(result.mentionedMobileList, ["13800000000", "13800000000"]);
  assert.equal(result.mobileConfigured, true);
});

test("正文@开关关闭后，超时提醒仍然应该只走底部手机号@", () => {
  const result = resolveEscalationMentionPlan(
    {
      staffName: "苏哲",
      staffGroup: "after_sales"
    },
    {
      memberMobileMap: {
        苏哲: "13800000000",
        黎路遥: "13800000000"
      },
      memberUserIdMap: {
        苏哲: "lishouyao"
      },
      memberInlineMentionEnabledMap: {
        苏哲: false
      }
    }
  );

  assert.deepEqual(result.inlineMentionTokenMap, {});
  assert.deepEqual(result.mentionedMobileList, ["13800000000", "13800000000"]);
  assert.equal(result.mobileConfigured, true);
});

test("运营接待继承到售前路由时不应该推到别的群", () => {
  const targets = resolveEscalationTargets(
    {
      staffGroup: "operation",
      routingGroup: "pre_sales"
    },
    {
      preSalesWebhookUrl: "https://example.com/pre",
      afterSalesWebhookUrl: "https://example.com/after"
    }
  );

  assert.deepEqual(targets, [
    {
      webhookName: "售前群",
      webhookUrl: "https://example.com/pre"
    }
  ]);
});

test("配置了通知群列表后应该给所有启用群发送", () => {
  const targets = resolveEscalationTargets(
    {
      staffGroup: "management"
    },
    {
      notificationGroups: [
        {
          id: "group_1",
          name: "全员群",
          webhookUrl: "https://example.com/all",
          enabled: true
        },
        {
          id: "group_2",
          name: "主管群",
          webhookUrl: "https://example.com/manager",
          enabled: true
        }
      ]
    }
  );

  assert.deepEqual(targets, [
    {
      webhookName: "全员群",
      webhookUrl: "https://example.com/all"
    },
    {
      webhookName: "主管群",
      webhookUrl: "https://example.com/manager"
    }
  ]);
});

test("停用的通知群不应该进入发送目标", () => {
  const targets = resolveEscalationTargets(
    {
      staffGroup: "management"
    },
    {
      notificationGroups: [
        {
          id: "group_1",
          name: "全员群",
          webhookUrl: "https://example.com/all",
          enabled: true
        },
        {
          id: "group_2",
          name: "暂停群",
          webhookUrl: "https://example.com/off",
          enabled: false
        }
      ]
    }
  );

  assert.deepEqual(targets, [
    {
      webhookName: "全员群",
      webhookUrl: "https://example.com/all"
    }
  ]);
});

test("同一个 webhook 被配置多次时只应该发送一次", () => {
  const targets = resolveEscalationTargets(
    {
      staffGroup: "management"
    },
    {
      notificationGroups: [
        {
          id: "group_1",
          name: "全员群",
          webhookUrl: "https://example.com/shared",
          enabled: true
        },
        {
          id: "group_2",
          name: "备份备注",
          webhookUrl: "https://example.com/shared",
          enabled: true
        }
      ]
    }
  );

  assert.deepEqual(targets, [
    {
      webhookName: "全员群 / 备份备注（同群）",
      webhookUrl: "https://example.com/shared"
    }
  ]);
});
