const test = require("node:test");
const assert = require("node:assert/strict");
const { 创建TUI } = require("../../src/tui/startTui");
const { 创建日志页 } = require("../../src/tui/pages/logs");
const { 脱敏账号, 构建店铺表格行, 构建记录明细行 } = require("../../src/tui/pages/stores");
const { 构建快捷操作 } = require("../../src/tui/pages/overview");

function 创建模拟输出() {
  return {
    writes: [],
    columns: 100,
    rows: 30,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    on() {},
    removeListener() {},
  };
}

test("总览快捷操作：批量巡检固定为第一项", () => {
  const 未登录操作 = 构建快捷操作({ task: null, cache: { serviceStatus: {} } });
  assert.deepEqual(未登录操作.map((操作) => 操作.id), ["batch", "download-center", "single", "exit"]);

  const 已登录操作 = 构建快捷操作({
    task: null,
    cache: { serviceStatus: { name: "诺诺登录", status: "ready" } },
  });
  assert.deepEqual(已登录操作.map((操作) => 操作.id), ["batch", "single", "download-center", "exit"]);
});

test("冒烟：四个页面都应该能无异常渲染出完整帧", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建TUI({ output });
  app.running = true;
  const 页面标题 = ["总览", "店铺", "日志", "配置"];

  for (let 索引 = 0; 索引 < 4; 索引 += 1) {
    app.切换页面(索引);
    const 帧 = app.构建帧();
    assert.ok(Array.isArray(帧), `页面 ${页面标题[索引]} 应返回帧数组`);
    assert.ok(帧.length >= 9, `页面 ${页面标题[索引]} 帧应至少 9 行`);
    assert.ok(帧[0].includes("京东开票巡检控制台"));
    assert.ok(帧.some((行) => 行.includes(页面标题[索引])));
  }
  dispose();
});

test("冒烟：日志页应该展示结构化日志并能按关键字过滤", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建TUI({ output });
  app.running = true;
  app.切换页面(2);
  const 日志页 = app.page;
  assert.ok(日志页);

  日志页.pushLine("[2026-08-15 09:00:00][logger.js:1][主线:巡检流程][主流程][开始执行开票巡检]");
  日志页.pushLine("[2026-08-15 09:00:05][logger.js:2][主线:巡检流程][失败截图][保存失败现场]");
  日志页.pushLine("[2026-08-15 09:00:10][logger.js:3][主线:登录检测][登录状态][登录态有效]");

  日志页.handleKey("/", app);
  "失败".split("").forEach((字符) => 日志页.handleKey(字符, app));
  日志页.handleKey("enter", app);
  const 可见行 = 日志页.获取可见行();
  assert.equal(可见行.length, 1);
  assert.ok(可见行[0].includes("失败"));

  日志页.handleKey("/", app);
  日志页.handleKey("esc", app);
  assert.equal(日志页.state.filterText, "失败");
  dispose();
});

test("店铺页：账号脱敏", () => {
  assert.equal(脱敏账号("13812345678"), "138***78");
  assert.equal(脱敏账号("ab"), "a***");
  assert.equal(脱敏账号(""), "未配置");
});

test("店铺页：镜像表格行包含关键指标且告警/待登记标红", () => {
  const 行 = 构建店铺表格行(0, { id: "s1", name: "A店" }, {
    status: "success",
    lastMessage: "排查完成：告警=1，待登记=2，已上传未逾期=3，明细=4，新增=1",
    lastCheckedAt: "2026-08-15T06:00:00.000Z",
    metrics: { 警告订单数: 1, 待登记明细数: 2, 已上传未逾期数: 3, 明细总数: 4 },
    newRecords: [{}],
  }, 100);
  assert.match(行, /A店/);
  assert.match(行, /排查完成/);
  assert.match(行, /1/);
  assert.match(行, /2/);
  assert.match(行, /3/);
  assert.match(行, /4/);
  assert.ok(行.includes("\x1b[91m") || 行.includes("\x1b[31m"));
});

test("店铺页：巡检记录明细行能给出状态和新增标记", () => {
  const 行 = 构建记录明细行(0, {
    id: "r1",
    source: "京东政企发票考核",
    summary: "订单号 123｜还有 3 天逾期",
    fields: { 订单号: "123" },
  }, true, 100);
  assert.match(行, /待登记即将逾期/);
  assert.match(行, /京东政企发票考核/);
  assert.match(行, /●/);
});


test("创建日志页独立可用，支持跟随与清屏", () => {
  const 日志页 = 创建日志页();
  日志页.pushLine("第一行");
  日志页.pushLine("第二行");
  assert.equal(日志页.state.lines.length, 2);
  assert.equal(日志页.state.follow, true);

  const app = { contentHeight: 10 };
  日志页.handleKey("up", app);
  assert.equal(日志页.state.follow, false);
  日志页.handleKey("r", app);
  assert.equal(日志页.state.lines.length, 0);
});
