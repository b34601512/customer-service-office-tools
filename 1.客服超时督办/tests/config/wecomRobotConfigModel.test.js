const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPersistedWecomRobotConfig,
  buildWecomRobotConfigModel
} = require("../../src/config/wecomRobotConfigModel");

test("旧版双 webhook 配置在地址相同时应该自动迁移成一个统一通知群", () => {
  const config = buildWecomRobotConfigModel({
    pre_sales_webhook_url: "https://example.com/shared",
    after_sales_webhook_url: "https://example.com/shared",
    member_mobile_map: {
      黎路遥: "13800000000"
    },
    member_userid_map: {
      苏哲: "lishouyao"
    }
  });

  assert.deepEqual(config.notificationGroups, [
    {
      id: "legacy_shared",
      name: "统一通知群",
      webhookUrl: "https://example.com/shared",
      enabled: true
    }
  ]);
  assert.equal(config.preSalesWebhookUrl, "https://example.com/shared");
  assert.equal(config.afterSalesWebhookUrl, "https://example.com/shared");
  assert.deepEqual(config.staffDirectory, [
    {
      id: "staff_1",
      name: "黎路遥",
      mobile: "13800000000",
      userId: "",
      inlineMentionEnabled: true
    },
    {
      id: "staff_2",
      name: "苏哲",
      mobile: "",
      userId: "lishouyao",
      inlineMentionEnabled: true
    }
  ]);
  assert.deepEqual(config.memberUserIdMap, {
    苏哲: "lishouyao"
  });
  assert.deepEqual(config.memberInlineMentionEnabledMap, {
    黎路遥: true,
    苏哲: true
  });
});

test("保存新的通知群列表时应该同时回写兼容旧版的双 webhook 字段", () => {
  const config = buildPersistedWecomRobotConfig({
    notificationGroups: [
      {
        id: "group_all",
        name: "全员群",
        webhookUrl: "https://example.com/all",
        enabled: true
      }
    ],
    staffDirectory: [
      {
        id: "staff_a",
        name: "黎路遥",
        mobile: "13800000000",
        userId: "liluyao",
        inlineMentionEnabled: true
      },
      {
        id: "staff_b",
        name: "苏哲",
        mobile: "13800000000",
        userId: "lishouyao",
        inlineMentionEnabled: false
      }
    ]
  });

  assert.equal(config.pre_sales_webhook_url, "https://example.com/all");
  assert.equal(config.after_sales_webhook_url, "https://example.com/all");
  assert.deepEqual(config.notification_groups, [
    {
      id: "group_all",
      name: "全员群",
      webhook_url: "https://example.com/all",
      enabled: true
    }
  ]);
  assert.deepEqual(config.member_directory, [
    {
      name: "黎路遥",
      mobile: "13800000000",
      user_id: "liluyao",
      inline_mention_enabled: true
    },
    {
      name: "苏哲",
      mobile: "13800000000",
      user_id: "lishouyao",
      inline_mention_enabled: false
    }
  ]);
  assert.deepEqual(config.member_mobile_map, {
    黎路遥: "13800000000",
    苏哲: "13800000000"
  });
  assert.deepEqual(config.member_userid_map, {
    黎路遥: "liluyao",
    苏哲: "lishouyao"
  });
  assert.deepEqual(config.member_inline_mention_enabled_map, {
    黎路遥: true,
    苏哲: false
  });
});

test("保存通知群列表时如果某一行缺少 webhook 应该直接抛错", () => {
  assert.throws(
    () =>
      buildPersistedWecomRobotConfig({
        notificationGroups: [
          {
            id: "group_invalid",
            name: "未填地址的群",
            webhookUrl: "",
            enabled: true
          }
        ]
      }),
    /第 1 个通知群未填写 webhook/
  );
});

test("读取新成员清单时应该自动回填手机号和 userid 映射", () => {
  const config = buildWecomRobotConfigModel({
    notification_groups: [
      {
        id: "group_all",
        name: "全员群",
        webhook_url: "https://example.com/all",
        enabled: true
      }
    ],
    member_directory: [
      {
        name: "唐悦",
        mobile: "18679725053",
        user_id: "xujianan"
      }
    ]
  });

  assert.deepEqual(config.staffDirectory, [
    {
      id: "staff_1",
      name: "唐悦",
      mobile: "18679725053",
      userId: "xujianan",
      inlineMentionEnabled: true
    }
  ]);
  assert.deepEqual(config.memberMobileMap, {
    唐悦: "18679725053"
  });
  assert.deepEqual(config.memberUserIdMap, {
    唐悦: "xujianan"
  });
  assert.deepEqual(config.memberInlineMentionEnabledMap, {
    唐悦: true
  });
});

test("保存成员清单时姓名重复应该直接抛错", () => {
  assert.throws(
    () =>
      buildPersistedWecomRobotConfig({
        notificationGroups: [
          {
            id: "group_all",
            name: "全员群",
            webhookUrl: "https://example.com/all",
            enabled: true
          }
        ],
        staffDirectory: [
          {
            id: "staff_1",
            name: "苏哲",
            mobile: "13800000000",
            userId: "",
            inlineMentionEnabled: true
          },
          {
            id: "staff_2",
            name: "苏哲",
            mobile: "13928400808",
            userId: "",
            inlineMentionEnabled: true
          }
        ]
      }),
    /成员姓名重复：苏哲/
  );
});

test("读取成员清单时应该兼容正文@启用开关", () => {
  const config = buildWecomRobotConfigModel({
    member_directory: [
      {
        name: "苏哲",
        mobile: "13800000000",
        user_id: "lishouyao",
        inline_mention_enabled: false
      }
    ]
  });

  assert.deepEqual(config.staffDirectory, [
    {
      id: "staff_1",
      name: "苏哲",
      mobile: "13800000000",
      userId: "lishouyao",
      inlineMentionEnabled: false
    }
  ]);
  assert.deepEqual(config.memberInlineMentionEnabledMap, {
    苏哲: false
  });
});
