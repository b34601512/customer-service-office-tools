const test = require("node:test");
const assert = require("node:assert/strict");
const { createAppPageHarness } = require("./controlCenterWebAppHelpers");

test("首页动作反馈应该写进对应流程节点", () => {
  const { context, elements } = createAppPageHarness();

  context.setWorkflowFeedback("start", "已收到「后台启动」指令，正在处理。", "pending", {
    title: "正在处理"
  });

  assert.equal(elements.workflowStepStart.classList.contains("running"), true);
  assert.equal(elements.workflowStartState.textContent, "正在处理");
  assert.equal(elements.workflowStartTime.textContent, "刚刚");
  assert.equal(elements.workflowStartDetail.textContent, "已收到「后台启动」指令，正在处理。");
});

test("首页脚本收到有效登录态后应该把首次登录节点标绿", () => {
  const { context, elements } = createAppPageHarness();

  context.renderLoginStatus({
    status: "valid",
    isValid: true,
    verifiedAt: "2026/6/17 14:10:00",
    detail: "登录记录已验证有效，可以直接后台启动。"
  });

  assert.equal(elements.workflowStepLogin.classList.contains("ok"), true);
  assert.equal(elements.workflowLoginState.textContent, "已登录");
  assert.equal(elements.workflowLoginTime.textContent, "2026/6/17 14:10:00");
  assert.equal(elements.workflowLoginDetail.textContent, "登录记录已验证有效，可以直接后台启动。");
});

test("首页脚本应该把客户镜像列表渲染进倒计时弹窗", () => {
  const { context, elements } = createAppPageHarness();
  const nowMs = Date.now();
  const scanAtMs = new Date("2026-06-26T11:40:59+08:00").getTime();

  context.renderDashboard({
    monitorSummary: {
      hasData: true,
      updatedAtText: "2026/6/26 11:40:59",
      totalCount: 1,
      attentionCount: 1,
      stateText: "需关注",
      detailText: "客户判定=1，需关注=1"
    },
    modeName: "测试模式",
    customerMirrorItems: [
      {
        chatId: "chat_1",
        customerName: "镜像客户",
        previewText: "帮我查订单",
        reasonText: "漏回复依据：临时回复后未实质回复",
        latestMessageRoleLabel: "客服",
        latestMessageSenderName: "客服A",
        latestMessageText: "稍等，我查一下",
        latestMessageAtMs: scanAtMs,
        lastCustomerMessageText: "谢谢",
        recentAgentReplyText: "稍等",
        recentReminderSnapshot: {
          reminderKindLabel: "超时提醒",
          reminderSentAtMs: scanAtMs - 10 * 1000,
          reasonLabel: "客户消息后无人实质回复",
          pendingDurationSeconds: 801,
          assigneeName: "客服A",
          assigneeRoleLabel: "售后客服",
          lastCustomerMessageText: "制氧机出现E9",
          recentAgentReplyText: "",
          dispatchTarget: "客服A + 黎路遥",
          webhookName: "测试群"
        },
        timeoutReminderTargetAtMs: nowMs + 60 * 1000,
        missedReplyReminderTargetAtMs: nowMs + 90 * 1000,
        missedReplyScannedAtMs: scanAtMs,
        statusTags: [
          { label: "待回复倒计时", type: "warning" },
          { label: "漏回复未到点", type: "warning" }
        ]
      }
    ]
  });

  assert.match(elements.customerMirrorList.innerHTML, /镜像客户/);
  assert.match(elements.customerMirrorList.innerHTML, /待回复倒计时/);
  assert.match(elements.customerMirrorList.innerHTML, /漏回复未到点/);
  assert.match(elements.customerMirrorList.innerHTML, /超时提醒/);
  assert.match(elements.customerMirrorList.innerHTML, /漏回复/);
  assert.match(elements.customerMirrorList.innerHTML, /还剩1分/);
  assert.match(elements.customerMirrorList.innerHTML, /customer-mirror-countdown-card is-active/);
  assert.match(elements.customerMirrorList.innerHTML, /#1/);
  assert.match(elements.customerMirrorList.innerHTML, /查看详情/);
  assert.match(elements.customerMirrorList.innerHTML, /最近提醒/);
  assert.doesNotMatch(elements.customerMirrorList.innerHTML, /最后有效消息/);
  assert.doesNotMatch(elements.customerMirrorList.innerHTML, /需处理客户消息/);
  assert.doesNotMatch(elements.customerMirrorList.innerHTML, /最近人工处理/);
  assert.match(elements.customerMirrorList.innerHTML, /2026\/6\/26/);
  assert.match(elements.customerMirrorList.innerHTML, /11:40:59/);
  assert.match(elements.customerMirrorSummary.textContent, /1 个客户/);
  assert.equal(elements.countdownAttentionBadge.textContent, "1");
  assert.equal(elements.countdownAttentionBadge.classList.contains("hidden"), false);
  assert.equal(elements.openCountdownModalButton.title, "有 1 个客户需要关注");
  assert.equal(elements.monitorUpdatedAtValue.textContent, "2026/6/26 11:40:59");
  assert.equal(elements.workflowMonitorState.textContent, "需关注");
  assert.equal(elements.workflowMonitorTime.textContent, "2026/6/26 11:40:59");

  context.openCustomerMirrorDetailByIndex(0);

  assert.equal(elements.customerMirrorDetailModal.classList.contains("hidden"), false);
  assert.match(elements.customerMirrorDetailTitle.textContent, /#1 镜像客户/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /最后有效消息/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /最近提醒复盘/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /提醒类型[\s\S]*超时提醒/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /提醒原因[\s\S]*客户消息后无人实质回复/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /当时客户消息[\s\S]*制氧机出现E9/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /发送目标[\s\S]*客服A \+ 黎路遥/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /客服：稍等，我查一下/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /客服A/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /需处理客户消息[\s\S]*谢谢/);
  assert.match(elements.customerMirrorDetailBody.innerHTML, /最近人工处理[\s\S]*稍等/);
});

test("首页倒计时按钮角标应该只统计需关注客户", () => {
  const { context, elements } = createAppPageHarness();

  context.renderDashboard({
    monitorSummary: {
      hasData: true,
      updatedAtText: "2026/6/26 09:10:00",
      totalCount: 3,
      attentionCount: 2,
      stateText: "需关注",
      detailText: "客户判定=3，需关注=2"
    },
    customerMirrorItems: [
      {
        chatId: "chat_1",
        customerName: "需关注客户",
        statusTags: [
          { label: "未进入超时", type: "neutral" },
          { label: "漏回复未到点", type: "warning" }
        ]
      },
      {
        chatId: "chat_2",
        customerName: "已恢复客户",
        statusTags: [
          { label: "未进入超时", type: "neutral" },
          { label: "提醒后已恢复", type: "success" }
        ]
      },
      {
        chatId: "chat_3",
        customerName: "已到点客户",
        statusTags: [
          { label: "超时已到点", type: "danger" },
          { label: "漏回复未到点", type: "warning" }
        ]
      }
    ]
  });

  assert.equal(elements.countdownAttentionBadge.textContent, "2");
  assert.equal(elements.countdownAttentionBadge.classList.contains("hidden"), false);

  context.renderDashboard({
    monitorSummary: {
      hasData: true,
      updatedAtText: "2026/6/26 09:12:00",
      totalCount: 1,
      attentionCount: 0,
      stateText: "已判定",
      detailText: "客户判定=1，需关注=0"
    },
    customerMirrorItems: [
      {
        chatId: "chat_1",
        customerName: "恢复客户",
        statusTags: [
          { label: "未进入超时", type: "neutral" },
          { label: "未进入漏回复", type: "neutral" },
          { label: "提醒后已恢复", type: "success" }
        ]
      }
    ]
  });

  assert.equal(elements.countdownAttentionBadge.textContent, "0");
  assert.equal(elements.countdownAttentionBadge.classList.contains("hidden"), true);
  assert.equal(elements.openCountdownModalButton.title, "当前没有需要关注的客户");
});

test("首页倒计时按钮角标超过 99 应该显示 99+", () => {
  const { context, elements } = createAppPageHarness();
  const customerMirrorItems = Array.from({ length: 120 }, (_, index) => ({
    chatId: `chat_${index + 1}`,
    customerName: `客户${index + 1}`,
    statusTags: [{ label: "漏回复未到点", type: "warning" }]
  }));

  context.renderDashboard({
    monitorSummary: {
      hasData: true,
      updatedAtText: "2026/6/26 09:10:00",
      totalCount: 120,
      attentionCount: 120,
      stateText: "需关注",
      detailText: "客户判定=120，需关注=120"
    },
    customerMirrorItems
  });

  assert.equal(elements.countdownAttentionBadge.textContent, "99+");
  assert.equal(elements.countdownAttentionBadge.classList.contains("hidden"), false);
  assert.equal(elements.openCountdownModalButton.title, "有 120 个客户需要关注");
});

test("首页脚本应该把资源占用渲染进弹窗", () => {
  const { context, elements } = createAppPageHarness();

  context.renderResourceUsage({
    capturedAt: "2026-06-26T03:40:59.000Z",
    cpuPercent: 12.3,
    memoryWorkingSetBytes: 256 * 1024 * 1024,
    memoryWorkingSetText: "256.0 MB",
    processCount: 2,
    processGroupCount: 2,
    logicalCpuCount: 8,
    processGroups: [
      {
        pid: 52001,
        name: "chrome.exe",
        role: "控制台浏览器",
        detailText: "chrome.exe｜根 PID 52001｜包含 2 个技术进程",
        cpuPercent: 4.1,
        memoryWorkingSetBytes: 128 * 1024 * 1024,
        memoryWorkingSetText: "128.0 MB",
        processCount: 2
      },
      {
        pid: 41002,
        name: "node.exe",
        role: "后台督办",
        detailText: "node.exe｜PID 41002",
        cpuPercent: 8.2,
        memoryWorkingSetBytes: 128 * 1024 * 1024,
        memoryWorkingSetText: "128.0 MB",
        processCount: 1
      }
    ],
    processes: [
      {
        pid: 41002,
        name: "node.exe",
        role: "后台督办",
        cpuPercent: 8.2,
        memoryWorkingSetBytes: 128 * 1024 * 1024,
        memoryWorkingSetText: "128.0 MB"
      },
      {
        pid: 52001,
        name: "chrome.exe",
        role: "浏览器进程",
        cpuPercent: 4.1,
        memoryWorkingSetBytes: 128 * 1024 * 1024,
        memoryWorkingSetText: "128.0 MB"
      }
    ]
  });

  assert.match(elements.resourceUsageSummary.innerHTML, /CPU/);
  assert.match(elements.resourceUsageSummary.innerHTML, /12\.3%/);
  assert.match(elements.resourceUsageSummary.innerHTML, /256\.0 MB/);
  assert.match(elements.resourceUsageSummary.innerHTML, /运行项/);
  assert.match(elements.resourceUsageSummary.innerHTML, /技术进程/);
  assert.match(elements.resourceUsageProcessList.innerHTML, /后台督办/);
  assert.match(elements.resourceUsageProcessList.innerHTML, /PID 41002/);
  assert.match(elements.resourceUsageProcessList.innerHTML, /控制台浏览器/);
  assert.match(elements.resourceUsageProcessList.innerHTML, /包含 2 个技术进程/);
  assert.doesNotMatch(elements.resourceUsageProcessList.innerHTML, /浏览器窗口/);
  assert.match(elements.resourceUsageUpdatedAt.textContent, /2026\/6\/26/);
});
