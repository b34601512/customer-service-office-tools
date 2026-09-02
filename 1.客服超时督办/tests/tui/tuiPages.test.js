const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfigPage, serializeKeywords, formatFieldValue, FIELDS } = require("../../src/controlCenter/tui/pages/config");
const { createWecomPage, normalizeSectionItems } = require("../../src/controlCenter/tui/pages/wecom");
const { createOverviewPage, buildActions } = require("../../src/controlCenter/tui/pages/overview");
const { createCustomersPage } = require("../../src/controlCenter/tui/pages/customers");
const { createReportsPage } = require("../../src/controlCenter/tui/pages/reports");

test("配置页：关键词数组应该序列化成一行一条的编辑文本", () => {
  const rules = [
    { text: "稍等", matchMode: "startsWith" },
    { text: "谢谢", matchMode: "exact" }
  ];
  const lines = serializeKeywords(rules);
  assert.deepEqual(lines, ["稍等 | startsWith", "谢谢 | exact"]);
});

test("配置页：字段值格式化应该覆盖全部字段类型", () => {
  const config = {
    targetUrl: "https://example.com",
    timeoutReminderThresholdSeconds: 300,
    missedReplyMonitorEnabled: true,
    onlinePresenceWorkStartTime: "08:00",
    missedReplyTemporaryReplyKeywords: [{ text: "稍等", matchMode: "startsWith" }]
  };
  const targetField = FIELDS.find((field) => field.key === "targetUrl");
  const boolField = FIELDS.find((field) => field.key === "missedReplyMonitorEnabled");
  const keywordField = FIELDS.find((field) => field.key === "missedReplyTemporaryReplyKeywords");
  assert.equal(formatFieldValue(targetField, config), "https://example.com");
  assert.equal(formatFieldValue(boolField, config), "开启");
  assert.equal(formatFieldValue(keywordField, config), "共 1 条规则");
});

test("配置页：buildPayload 应该以当前配置为底叠加编辑值", () => {
  const page = createConfigPage();
  page.state.config = {
    targetUrl: "https://old.example.com",
    timeoutReminderThresholdSeconds: 300,
    missedReplyMonitorEnabled: true,
    missedReplyTemporaryReplyKeywords: [{ text: "稍等", matchMode: "startsWith" }]
  };
  page.state.edits = {
    targetUrl: "https://new.example.com"
  };
  const payload = page.buildPayload();
  assert.equal(payload.targetUrl, "https://new.example.com");
  assert.equal(payload.timeoutReminderThresholdSeconds, 300);
  assert.equal(payload.missedReplyMonitorEnabled, true);
  assert.ok(Array.isArray(payload.missedReplyTemporaryReplyKeywords));
});

test("配置页：关键词编辑器保存后应该把多行文本写进 edits", () => {
  const page = createConfigPage();
  const field = FIELDS.find((item) => item.key === "missedReplyTemporaryReplyKeywords");
  page.state.keywordEditor = {
    field,
    label: "稍等类临时回复关键词",
    lines: ["稍等 | startsWith", "请稍等 | startsWith"],
    selection: 0,
    inputActive: false,
    inputBuffer: ""
  };
  const fakeApp = { ctx: { services: {} } };
  page.handleKeywordEditorKey("s", fakeApp);
  assert.equal(page.state.keywordEditor, null);
  assert.equal(page.state.edits[field.key], "稍等 | startsWith\n请稍等 | startsWith");
});

test("企微页：模型应该归一化成通知群和成员目录两份列表", () => {
  const model = {
    notificationGroups: [
      { id: "g1", name: "售前群", webhookUrl: "https://qyapi.weixin.qq.com/xxx", enabled: true }
    ],
    staffDirectory: [
      { name: "张三", mobile: "13800000000", userId: "", inlineMentionEnabled: true }
    ]
  };
  const items = normalizeSectionItems(model);
  assert.equal(items.groups.length, 1);
  assert.equal(items.groups[0].name, "售前群");
  assert.equal(items.staff.length, 1);
  assert.equal(items.staff[0].mobile, "13800000000");
});

test("企微页：成员行应该能按分隔符解析回对象", () => {
  const page = createWecomPage();
  page.state.section = 1;
  const parsed = page.parseItem("李四|13900000000|user_lisi|否", null);
  assert.equal(parsed.name, "李四");
  assert.equal(parsed.mobile, "13900000000");
  assert.equal(parsed.userId, "user_lisi");
  assert.equal(parsed.inlineMentionEnabled, false);
});

test("企微页：超长动态字段不能把后续列推开", () => {
  const { stripAnsi, displayWidth } = require("../../src/controlCenter/tui/width");
  const page = createWecomPage();
  page.state.groups = [{
    name: "售后超长通知群名称｜旧省略...",
    webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=very-long-key...",
    enabled: true
  }];
  const lines = page.render({ columns: 100, contentHeight: 20 });
  const row = stripAnsi(lines[2]);
  assert.ok(displayWidth(row) <= 100);
  assert.doesNotMatch(row, /[|｜]|\.\.\./);
  assert.match(row, /开启/);
});

test("总览页：动作列表应该随任务状态变化", () => {
  const { buildActions } = require("../../src/controlCenter/tui/pages/overview");
  const idleActions = buildActions({ currentTask: null }, { isValid: true });
  assert.ok(idleActions.some((action) => action.id === "start" && action.enabled));
  assert.ok(idleActions.some((action) => action.id === "login" && action.enabled));
  // 登录有效时首次登录不常用，应该排在最后
  assert.equal(idleActions[idleActions.length - 1].id, "login");
  assert.equal(idleActions[0].id, "start");

  const runningState = {
    currentTask: { taskName: "start", label: "后台督办", status: "running" }
  };
  const runningActions = buildActions(runningState, { isValid: true });
  assert.ok(runningActions.some((action) => action.id === "stop" && action.enabled));
  assert.ok(runningActions.some((action) => action.id === "start" && !action.enabled));

  const awaitingState = {
    currentTask: { taskName: "login", label: "首次登录", status: "running", awaitingConfirmation: true }
  };
  const awaitingActions = buildActions(awaitingState, { isValid: false });
  assert.ok(awaitingActions.some((action) => action.id === "confirm" && action.enabled));
});

test("总览页：登录态失效时首次登录应该置顶", () => {
  const { buildActions } = require("../../src/controlCenter/tui/pages/overview");
  const invalidActions = buildActions({ currentTask: null }, { isValid: false });
  assert.equal(invalidActions[0].id, "login");
  // 任务运行中即使登录失效也不置顶（后台已在跑）
  const runningActions = buildActions(
    { currentTask: { taskName: "start", label: "后台督办", status: "running" } },
    { isValid: false }
  );
  assert.notEqual(runningActions[0].id, "login");
  assert.equal(runningActions[runningActions.length - 1].id, "login");
});

test("总览页：渲染前选中项应该自动校正到第一个可用动作", () => {
  const { createOverviewPage, buildActions, ensureEnabledSelection } = require("../../src/controlCenter/tui/pages/overview");
  const page = createOverviewPage();
  page.ctx = {
    state: { currentTask: { taskName: "start", label: "后台督办", status: "running" } },
    cache: { loginStatus: { isValid: true } }
  };
  // 首次渲染（selection 初始为 0，而第 0 项“后台启动”运行中不可用）
  page.render({ ctx: page.ctx, columns: 100, contentHeight: 20 });
  const actions = buildActions(page.ctx.state, page.ctx.cache.loginStatus);
  assert.ok(actions[page.state.selection].enabled, "选中项应该落在可用动作上");
  assert.equal(actions[page.state.selection].id, "stop");

  // 校正函数本身也应能处理任意初始值
  const state = { selection: 0 };
  ensureEnabledSelection(state, actions);
  assert.equal(state.selection, 1);
});

test("客户页：剩余时间应该优先展示有倒计时的提醒类型", () => {
  const { resolveRemainingText } = require("../../src/controlCenter/tui/pages/customers");
  assert.equal(resolveRemainingText({ timeoutReminderRemainingSeconds: 90 }), "超时 01:30");
  assert.equal(resolveRemainingText({ missedReplyReminderRemainingSeconds: 65 }), "漏回复 01:05");
  assert.equal(resolveRemainingText({ timeoutReminderRemainingSeconds: 0, missedReplyReminderRemainingSeconds: 0 }), "");
});

test("客户页：状态标签应该拆成超时/漏回复/其它三列", () => {
  const { splitStatusTags } = require("../../src/controlCenter/tui/pages/customers");
  const split = splitStatusTags({
    statusTags: [
      { label: "超时已到点", type: "danger" },
      { label: "漏回复未到点", type: "warning" },
      { label: "提醒后已恢复", type: "success" }
    ]
  });
  assert.equal(split.timeoutTag.label, "超时已到点");
  assert.equal(split.missedReplyTag.label, "漏回复未到点");
  assert.equal(split.extraTags.length, 1);
  assert.equal(split.extraTags[0].label, "提醒后已恢复");
});

test("客户页：未进入超时/未进入漏回复 应该归入对应列", () => {
  const { splitStatusTags } = require("../../src/controlCenter/tui/pages/customers");
  const split = splitStatusTags({
    statusTags: [
      { label: "未进入超时", type: "neutral" },
      { label: "未进入漏回复", type: "neutral" },
      { label: "最近漏回复提醒", type: "success" }
    ]
  });
  assert.equal(split.timeoutTag.label, "未进入超时");
  assert.equal(split.missedReplyTag.label, "未进入漏回复");
  assert.equal(split.extraTags.length, 1);
  assert.equal(split.extraTags[0].label, "最近漏回复提醒");
});

test("客户页：表格行应该用分隔线分列且不超宽", () => {
  const { displayWidth } = require("../../src/controlCenter/tui/width");
  const { buildCustomerRow, buildCustomerHeader } = require("../../src/controlCenter/tui/pages/customers");
  const item = {
    customerName: "🐒 性定菜根香🐒",
    statusTags: [
      { label: "超时已到点", type: "danger" },
      { label: "漏回复已提醒", type: "success" }
    ],
    timeoutReminderRemainingSeconds: 65,
    previewText: "您好，E3是压缩机工作电流异常的提醒"
  };
  const row = buildCustomerRow(0, item, 80);
  const header = buildCustomerHeader(80);
  assert.ok(row.includes("│"));
  assert.ok(header.includes("超时状态"));
  assert.ok(header.includes("漏回复状态"));
  assert.ok(displayWidth(row) <= 80);
  assert.ok(displayWidth(header) <= 80);
  // 列分隔符数量：序号/客户/超时/漏回复/倒计时/最近消息 = 5 个
  assert.equal((row.match(/│/g) || []).length, 5);
});

test("客户页：组合符号和表情昵称不能推歪列边界", () => {
  const { stripAnsi, displayWidth } = require("../../src/controlCenter/tui/width");
  const { buildCustomerRow, buildCustomerHeader } = require("../../src/controlCenter/tui/pages/customers");
  const separatorPositions = (text) => {
    const parts = stripAnsi(text).split("│");
    let consumedWidth = 0;
    return parts.slice(0, -1).map((part) => {
      consumedWidth += displayWidth(part);
      const separatorPosition = consumedWidth;
      consumedWidth += displayWidth("│");
      return separatorPosition;
    });
  };
  const names = [
    "এ心᭄ོꦿ惢࿐【客户】",
    "👍🏽测试【客户】",
    "👨‍👩‍👧‍👦家庭【客户】",
    "Yann💕【客户】"
  ];
  const expectedPositions = separatorPositions(buildCustomerHeader(80));

  for (const customerName of names) {
    const row = buildCustomerRow(0, {
      customerName,
      statusTags: [
        { label: "未进入超时", type: "neutral" },
        { label: "未进入漏回复", type: "neutral" }
      ],
      previewText: "【小程序】"
    }, 80);
    assert.deepEqual(separatorPositions(row), expectedPositions, customerName);
  }
});

test("客户页：超长客户名应该截断而不是撑破表格", () => {
  const { displayWidth } = require("../../src/controlCenter/tui/width");
  const { buildCustomerRow } = require("../../src/controlCenter/tui/pages/customers");
  const longNameItem = {
    customerName: "顺丰—德达查催群-深圳&湖南顺丰—德达查催群",
    statusTags: [{ label: "未进入超时", type: "neutral" }, { label: "未进入漏回复", type: "neutral" }],
    previewText: "易婷婷：SF1227191794765"
  };
  const row = buildCustomerRow(0, longNameItem, 80);
  assert.ok(displayWidth(row) <= 80);
  assert.ok(row.includes("…"));
});

test("客户页：单元格里的旧分隔符和省略号不能伪装成列边界", () => {
  const { stripAnsi, displayWidth } = require("../../src/controlCenter/tui/width");
  const { buildCustomerRow, buildCustomerHeader } = require("../../src/controlCenter/tui/pages/customers");
  const item = {
    customerName: "拼多多03店｜售后...",
    statusTags: [
      { label: "超时｜已到点...", type: "danger" },
      { label: "漏回复|已提醒...", type: "success" }
    ],
    previewText: "下载中心没有找到可下载发票。系统已处理..."
  };
  const header = stripAnsi(buildCustomerHeader(80));
  const row = stripAnsi(buildCustomerRow(0, item, 80));
  const separatorPositions = (text) => {
    const parts = text.split("│");
    let consumedWidth = 0;
    return parts.slice(0, -1).map((part) => {
      consumedWidth += displayWidth(part);
      const separatorPosition = consumedWidth;
      consumedWidth += displayWidth("│");
      return separatorPosition;
    });
  };
  assert.deepEqual(separatorPositions(row), separatorPositions(header));
  assert.doesNotMatch(row, /[|｜]/);
  assert.doesNotMatch(row, /\.\.\./);
  assert.equal((row.match(/│/g) || []).length, 5);
});

test("客户页：过滤模式应该只保留对应状态的客户", () => {
  const { filterCustomerItems } = require("../../src/controlCenter/tui/pages/customers");
  const items = [
    { customerName: "普通客户", statusTags: [{ label: "未进入超时", type: "neutral" }] },
    { customerName: "即将到点", statusTags: [{ label: "超时未到点", type: "warning" }] },
    { customerName: "已到点", statusTags: [{ label: "超时已到点", type: "danger" }] },
    { customerName: "已提醒", statusTags: [{ label: "超时已提醒", type: "success" }] }
  ];
  const attention = filterCustomerItems(items, 0);
  assert.deepEqual(attention.map((item) => item.customerName), ["即将到点", "已到点"]);
  const alert = filterCustomerItems(items, 1);
  assert.deepEqual(alert.map((item) => item.customerName), ["已到点"]);
  const all = filterCustomerItems(items, 2);
  assert.equal(all.length, 4);
});

test("客户页：f 键应该循环切换过滤模式", () => {
  const { createCustomersPage } = require("../../src/controlCenter/tui/pages/customers");
  const page = createCustomersPage();
  // 客户页默认展示全部，按 f 后再依次切换到需关注、已到点。
  assert.equal(page.state.filterMode, 2);
  page.cycleFilterMode();
  assert.equal(page.state.filterMode, 0);
  page.cycleFilterMode();
  assert.equal(page.state.filterMode, 1);
  page.cycleFilterMode();
  assert.equal(page.state.filterMode, 2);
});

test("报表页：柱状对比不超终端宽度且可切换范围和排序", () => {
  const { displayWidth, stripAnsi } = require("../../src/controlCenter/tui/width");
  const nowMs = Date.now();
  const page = createReportsPage();
  const app = {
    columns: 80,
    contentHeight: 16,
    ctx: {
      services: {
        readPerformanceLedger: () => ({
          startedAtMs: nowMs - 100000,
          staffObservations: [
            { observedAtMs: nowMs, assigneeUserId: "a", assigneeName: "超长客服姓名甲" },
            { observedAtMs: nowMs, assigneeUserId: "b", assigneeName: "客服乙" }
          ],
          timeoutEvents: [
            { notifiedAtMs: nowMs - 50000, thresholdAtMs: nowMs - 60000, thresholdSeconds: 150, resolvedAtMs: nowMs - 10000, assigneeUserId: "a", assigneeName: "超长客服姓名甲" }
          ]
        })
      }
    }
  };

  page.onEnter(app);
  const lines = page.render(app);
  assert.ok(lines.some((line) => stripAnsi(line).includes("无超时")));
  assert.ok(lines.some((line) => stripAnsi(line).includes("累计/平均按单次漏回复阈值封顶")));
  assert.ok(lines.every((line) => displayWidth(line) <= 80));
  app.columns = 120;
  assert.ok(page.render(app).every((line) => displayWidth(line) <= 120));
  assert.equal(page.state.sortKey, "count");
  assert.equal(page.handleKey("s", app), true);
  assert.equal(page.state.sortKey, "total");
  assert.equal(page.handleKey("]", app), true);
  assert.match(page.state.rangeKey, /^month:/);
});
