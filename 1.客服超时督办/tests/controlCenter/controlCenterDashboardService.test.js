const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMonitorSummary } = require("../../src/controlCenter/controlCenterDashboardService");
const { buildCustomerMirrorItems } = require("../../src/controlCenter/customerMirrorListBuilder");

test("客户镜像列表应该以统一未回复引擎为主并叠加超时和漏回复标签", () => {
  const nowMs = 1800000000000;
  const items = buildCustomerMirrorItems(
    {
      decisionItemsByChatId: {
        chat_1: {
          chatId: "chat_1",
          customerName: "镜像客户",
          assignedToUserId: "staff_a",
          assignmentStatus: "assigned",
          assignmentStatusLabel: "当前会话已分配客服",
          contactListIndex: 1,
          previewText: "帮我查一下",
          statusLabel: "漏回复倒计时中",
          decisionReason: "临时回复后未实质回复",
          latestMessageRole: "agent",
          latestMessageSenderName: "客服A",
          latestMessageText: "稍等，我查一下",
          latestMessageAtMs: nowMs - 5000,
          isPendingTimeoutReplyCandidate: false,
          timeoutStatusLabel: "未进入超时",
          timeoutDecisionReason: "已有人工临时回复，只等待漏回复提醒阈值",
          timeoutShouldRemind: false,
          timeoutReminderTargetAtMs: 0,
          isPendingMissedReplyCandidate: true,
          missedReplyStatusLabel: "漏回复倒计时中",
          missedReplyDecisionReason: "临时回复后未实质回复",
          missedReplyReminderTargetAtMs: nowMs + 1200 * 1000,
          nextReminderKind: "missedReply",
          nextReminderAtMs: nowMs + 1200 * 1000,
          pendingDurationSeconds: 300,
          scannedAtMs: nowMs - 1000
        }
      },
      reminderEventsByChatId: {},
      countdownItemsByChatId: {
        chat_1: {
          nextReminderKind: "missedReply",
          nextReminderAtMs: nowMs + 1200 * 1000
        }
      }
    },
    nowMs
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].customerName, "镜像客户");
  assert.equal(items[0].latestMessageRoleLabel, "客服");
  assert.equal(items[0].latestMessageSenderName, "客服A");
  assert.equal(items[0].latestMessageText, "稍等，我查一下");
  assert.equal(items[0].latestMessageAtMs, nowMs - 5000);
  assert.deepEqual(
    items[0].statusTags.map((tag) => tag.label),
    ["当前会话已分配客服", "未进入超时", "漏回复未到点"]
  );
  assert.equal(items[0].timeoutReminderRemainingSeconds, 0);
  assert.equal(items[0].missedReplyReminderRemainingSeconds, 1200);
});

test("客户镜像列表应该标出已发送漏回复提醒", () => {
  const nowMs = 1800000000000;
  const items = buildCustomerMirrorItems(
    {
      decisionItemsByChatId: {
        chat_1: {
          chatId: "chat_1",
          customerName: "已提醒客户",
          assignedToUserId: "",
          assignmentStatus: "unassigned",
          assignmentStatusLabel: "当前会话未分配客服",
          contactListIndex: 1,
          statusLabel: "漏回复已到点",
          decisionReason: "客户消息后无人实质回复",
          missedReplyShouldRemind: true,
          isPendingMissedReplyCandidate: true,
          scannedAtMs: nowMs - 1000
        }
      },
      countdownItemsByChatId: {},
      reminderEventsByChatId: {
        chat_1: {
          lastCustomerMessageAtMs: nowMs - 1600 * 1000,
          pendingSinceAtMs: nowMs - 1600 * 1000,
          missedReplyReminderSentAtMs: nowMs - 5000
        }
      }
    },
    nowMs
  );

  assert.deepEqual(
    items[0].statusTags.map((tag) => tag.label),
    ["当前会话未分配客服", "未进入超时", "漏回复已提醒"]
  );
});

test("客户镜像列表没有统一判定项时不应该生成旧平台快照客户", () => {
  const nowMs = 1800000000000;
  const items = buildCustomerMirrorItems(
    {
      decisionItemsByChatId: {},
      countdownItemsByChatId: {},
      reminderEventsByChatId: {}
    },
    nowMs
  );

  assert.equal(items.length, 0);
});

test("客户镜像列表应该展示最近提醒复盘但不改变当前正常判定", () => {
  const nowMs = 1800000000000;
  const items = buildCustomerMirrorItems(
    {
      decisionItemsByChatId: {
        chat_1: {
          chatId: "chat_1",
          customerName: "恢复客户",
          assignedToUserId: "staff_a",
          assignmentStatus: "assigned",
          assignmentStatusLabel: "当前会话已分配客服",
          contactListIndex: 1,
          statusLabel: "未进入漏回复",
          decisionReason: "客户消息后已有人工实质回复",
          timeoutStatusLabel: "未进入超时",
          timeoutDecisionReason: "客户消息后已有人工实质回复",
          timeoutShouldRemind: false,
          isPendingTimeoutReplyCandidate: false,
          missedReplyStatusLabel: "未进入漏回复",
          missedReplyDecisionReason: "客户消息后已有人工实质回复",
          missedReplyShouldRemind: false,
          isPendingMissedReplyCandidate: false,
          pendingDurationSeconds: 90,
          scannedAtMs: nowMs
        }
      },
      countdownItemsByChatId: {},
      reminderEventsByChatId: {},
      reminderSnapshotsByChatId: {
        chat_1: {
          chatId: "chat_1",
          customerName: "恢复客户",
          reminderKind: "timeout",
          reminderSentAtMs: nowMs - 10 * 1000,
          reasonLabel: "客户消息后无人实质回复",
          pendingDurationSeconds: 801,
          assignedToUserId: "staff_a",
          assignmentStatus: "assigned",
          assignmentStatusLabel: "当前会话已分配客服",
          assigneeName: "客服A",
          assigneeRoleLabel: "售后客服",
          lastCustomerMessageText: "制氧机出现E9",
          recentAgentReplyText: "",
          dispatchTarget: "客服A + 黎路遥",
          webhookName: "测试群"
        }
      }
    },
    nowMs
  );

  assert.deepEqual(
    items[0].statusTags.map((tag) => tag.label),
    ["当前会话已分配客服", "未进入超时", "未进入漏回复", "提醒后已恢复"]
  );
  assert.equal(items[0].timeoutReminderRemainingSeconds, 0);
  assert.equal(items[0].missedReplyReminderRemainingSeconds, 0);
  assert.equal(items[0].recentReminderSnapshot.reasonLabel, "客户消息后无人实质回复");
  assert.equal(items[0].recentReminderSnapshot.dispatchTarget, "客服A + 黎路遥");
});

test("首页运行巡检摘要应该只取统一判定时间", () => {
  const summary = buildMonitorSummary(
    { updatedAt: "2026/7/4 10:00:00" },
    [
      {
        missedReplyScannedAtMs: new Date("2026-07-04T11:34:16+08:00").getTime(),
        statusTags: [{ label: "漏回复未到点", type: "warning" }]
      },
      {
        missedReplyScannedAtMs: new Date("2026-07-04T11:30:00+08:00").getTime(),
        statusTags: [{ label: "未进入超时", type: "neutral" }]
      }
    ]
  );

  assert.equal(summary.hasData, true);
  assert.match(summary.updatedAtText, /2026\/7\/4/);
  assert.match(summary.updatedAtText, /11:34:16/);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.attentionCount, 1);
  assert.equal(summary.stateText, "需关注");
});
