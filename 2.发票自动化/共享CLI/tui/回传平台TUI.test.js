const test = require("node:test");
const assert = require("node:assert/strict");
const { 创建回传平台TUI, 创建初始任务 } = require("./回传平台TUI");
const { 开始捕获控制台输出 } = require("./控制台捕获");

function 创建模拟输出() {
  return {
    writes: [],
    columns: 100,
    rows: 26,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    on() {},
    removeListener() {},
  };
}

function 创建模拟服务() {
  const 店铺列表 = [
    { id: "s1", name: "A店", enabled: true, username: "user1", targetUrl: "https://example.com/login" },
    { id: "s2", name: "B店", enabled: false, username: "user2", targetUrl: "https://example.com/login" },
  ];
  return {
    读取店铺配置: () => ({ stores: 店铺列表 }),
    保存店铺配置: (配置) => 配置,
    订阅日志: () => () => {},
  };
}

test("冒烟：四个页面都应该能无异常渲染出完整帧", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    快捷操作: [{ id: "demo", 标签: "演示操作", 提示: "测试提示" }],
  });
  app.running = true;
  const 页面标题 = ["总览", "店铺", "日志", "配置"];

  for (let 索引 = 0; 索引 < 4; 索引 += 1) {
    app.切换页面(索引);
    const 帧 = app.构建帧();
    assert.ok(Array.isArray(帧), `页面 ${页面标题[索引]} 应返回帧数组`);
    assert.ok(帧.length >= 9, `页面 ${页面标题[索引]} 帧应至少 9 行`);
    assert.ok(帧[0].includes("模拟回传控制台"));
    assert.ok(帧.some((行) => 行.includes(页面标题[索引])));
  }
  dispose();
});

test("控制台捕获：业务 console 输出被重定向进日志页，退出后恢复", () => {
  const 记录列表 = [];
  const 恢复 = 开始捕获控制台输出((行) => 记录列表.push(行));
  console.log("测试日志", 123);
  console.error("错误日志");
  assert.equal(记录列表.length, 2);
  assert.match(记录列表[0], /测试日志 123/);
  恢复();
  const 原控制台日志 = console.log;
  assert.equal(typeof 原控制台日志, "function");
});

test("日志页：顶部显示本次任务总览和最近失败原因", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
  });
  const 日志页 = app.pages.find((页面) => 页面.key === "3");
  日志页.pushLine("[店铺] A店｜error｜成功 0/3｜跳过 0｜失败 3");
  日志页.pushLine("[店铺] B店｜skipped｜成功 0/0｜跳过 0｜失败 0");
  日志页.pushLine("[进度] A店｜订单1｜下载失败：诺诺登录态已失效");
  app.切换页面(2);
  const 帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("本次任务总览")));
  assert.ok(帧.some((行) => 行.includes("店铺 2 家")));
  assert.ok(帧.some((行) => 行.includes("发票：成功 0｜跳过 0｜失败 3")));
  assert.ok(帧.some((行) => 行.includes("诺诺登录态已失效")));
  dispose();
});

test("首页外部服务状态：可用状态显示绿色语义标签", async () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    外部服务名称: "下载中心",
    读取外部服务状态: async () => ({ status: "ready", label: "可用", detail: "本机服务" }),
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.切换页面(0);
  const 帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("下载中心") && 行.includes("可用")));
  dispose();
});

test("首页快捷操作：未登录时下载中心排第一，登录后沉底", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    打开下载中心: () => {},
    快捷操作: [{ id: "demo", 标签: "演示操作" }],
  });
  const 总览页 = app.pages.find((页面) => 页面.key === "1");

  app.ctx.cache.serviceStatus = { items: [{ name: "诺诺登录", status: "error" }] };
  let 操作列表 = 总览页.构建快捷操作(app.ctx);
  assert.equal(操作列表[0].id, "download-center");

  app.ctx.cache.serviceStatus = { items: [{ name: "诺诺登录", status: "ready" }] };
  操作列表 = 总览页.构建快捷操作(app.ctx);
  const 操作ID列表 = 操作列表.map((操作) => 操作.id);
  assert.ok(操作ID列表.indexOf("download-center") > 操作ID列表.indexOf("demo"));
  assert.ok(操作ID列表.includes("refresh-status"), "应内置“刷新下载中心状态”快捷操作");
  assert.equal(操作列表[操作列表.length - 1].id, "exit");
  dispose();
});

test("刷新下载中心状态：回车后调用刷新外部服务状态并更新提示", async () => {
  const output = 创建模拟输出();
  let 刷新次数 = 0;
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    读取外部服务状态: async () => {
      刷新次数 += 1;
      return { status: "ready", label: "可用" };
    },
  });
  app.running = true;
  app.切换页面(0);
  const 总览页 = app.pages.find((页面) => 页面.key === "1");
  const 操作列表 = 总览页.构建快捷操作(app.ctx);
  const 刷新操作索引 = 操作列表.findIndex((操作) => 操作.id === "refresh-status");
  assert.ok(刷新操作索引 >= 0);
  app.ctx.task = {};
  app.分发按键("down");
  await 总览页.执行操作(操作列表[刷新操作索引], app);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(刷新次数 >= 1, "回车刷新应触发外部服务状态读取");
  assert.ok(总览页.state.message.includes("已刷新"));
  dispose();
});

test("总览页快捷操作：回车执行动作并更新任务状态", async () => {
  const output = 创建模拟输出();
  let 动作执行次数 = 0;
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    快捷操作: [{ id: "demo", 标签: "演示操作", 提示: "测试提示" }],
    操作动作: {
      demo: async (上下文) => {
        await 上下文.services.启动任务(async () => {
          动作执行次数 += 1;
        });
      },
    },
  });
  app.running = true;
  app.切换页面(0);

  app.分发按键("enter");
  // 启动任务是异步的，等待任务完成。
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(动作执行次数, 1);
  assert.equal(app.ctx.task.status, "done");
  dispose();
});

test("任务互斥：任务运行中再次启动应被拒绝", async () => {
  const output = 创建模拟输出();
  let 内部任务开始 = false;
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
  });
  app.running = true;

  const 第一个任务 = app.ctx.services.启动任务(async () => {
    内部任务开始 = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(内部任务开始, true);
  await assert.rejects(
    () => app.ctx.services.启动任务(async () => {}),
    /已有任务在运行中/
  );
  await 第一个任务;
  dispose();
});

test("打开下载中心动作会立即刷新外部服务状态", async () => {
  const output = 创建模拟输出();
  let 状态读取次数 = 0;
  let 打开次数 = 0;
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    打开下载中心: () => { 打开次数 += 1; },
    读取外部服务状态: async () => {
      状态读取次数 += 1;
      return { status: "ready", label: "可用", items: [{ name: "诺诺登录", status: "ready", label: "可用" }] };
    },
    快捷操作: [{ id: "demo", 标签: "演示操作" }],
  });
  app.running = true;
  app.切换页面(0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const 总览页 = app.pages.find((页面) => 页面.key === "1");
  const 下载中心操作 = { id: "download-center", 标签: "发票下载中心" };
  const 起始读取次数 = 状态读取次数;
  await 总览页.执行操作(下载中心操作, app);
  assert.equal(打开次数, 1);
  assert.ok(状态读取次数 > 起始读取次数);
  assert.match(总览页.state.message, /诺诺登录/);
  dispose();
});

test("店铺页：读取店铺订单时渲染镜像表格，并可回车查看订单明细", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    读取店铺订单: (店铺) => {
      if (店铺.id !== "s1") return [];
      return [
        { key: "s1:o1", storeId: "s1", storeName: "A店", orderNumber: "1001", workflowStatus: "pending", platformStatus: { text: "可录入发票", kind: "returnable" }, lastReturnAttempt: { status: "error", message: "下载失败：诺诺登录态已失效" }, updatedAt: "2026-08-15T06:00:00.000Z" },
        { key: "s1:o2", storeId: "s1", storeName: "A店", orderNumber: "1002", workflowStatus: "handled", platformStatus: { text: "已上传", kind: "success" }, lastReturnAttempt: { status: "success", message: "回传成功" }, updatedAt: "2026-08-15T06:00:01.000Z" },
      ];
    },
  });
  app.running = true;
  app.切换页面(1);
  let 帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("订单明细")));
  assert.ok(帧.some((行) => 行.includes("1001")));
  assert.ok(帧.some((行) => 行.includes("待处理")));

  app.分发按键("enter");
  帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("订单：1001")));
  assert.ok(帧.some((行) => 行.includes("诺诺登录态已失效")));
  app.分发按键("esc");

  app.切换页面(2);
  帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("待处理") && 行.includes("处理中")));
  assert.ok(帧.some((行) => 行.includes("A店")));

  app.分发按键("enter");
  帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("店铺订单明细：A店")));
  assert.ok(帧.some((行) => 行.includes("1001")));
  dispose();
});

test("订单页：a 可以把选中待处理订单一键标记为已安排", () => {
  const output = 创建模拟输出();
  let 当前订单 = { key: "s1:o1", storeId: "s1", storeName: "A店", orderNumber: "1001", workflowStatus: "pending" };
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    读取全部订单: () => [当前订单],
    订单页标记已安排: (订单) => {
      当前订单 = { ...订单, workflowStatus: "processing" };
      return 当前订单;
    },
  });
  app.running = true;
  app.切换页面(1);
  app.分发按键("a");
  assert.equal(当前订单.workflowStatus, "processing");
  assert.ok(app.page.state.message.includes("已标记为已安排"));
  dispose();
});

test("店铺订单明细：a 也可以把选中订单一键标记为已安排", () => {
  const output = 创建模拟输出();
  let 标记次数 = 0;
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    读取店铺订单: () => [{
      key: "s1:detail-1",
      storeId: "s1",
      storeName: "A店",
      orderNumber: "detail-1",
      workflowStatus: "pending",
    }],
    订单页标记已安排: () => {
      标记次数 += 1;
      return { workflowStatus: "processing" };
    },
  });
  app.running = true;
  app.切换页面(2);
  app.分发按键("enter");
  app.分发按键("a");
  assert.equal(标记次数, 1);
  assert.match(app.page.state.detailMessage, /已标记为已安排/);
  dispose();
});

test("订单页：进入订单明细后按 Esc 可以返回列表", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建回传平台TUI({
    标题: "模拟回传控制台",
    output,
    ...创建模拟服务(),
    读取全部订单: () => [{
      key: "s1:o1",
      storeId: "s1",
      storeName: "A店",
      orderNumber: "1001",
      workflowStatus: "pending",
    }],
  });
  app.running = true;
  app.切换页面(1);
  app.分发按键("enter");
  assert.ok(app.page.state.detail);
  app.分发按键("esc");
  assert.equal(app.page.state.detail, null);
  dispose();
});
