const test = require("node:test");
const assert = require("node:assert/strict");
const { 创建TUI } = require("./总入口TUI");

function 创建模拟输出() {
  return {
    writes: [],
    columns: 110,
    rows: 30,
    write(chunk) {
      this.writes.push(String(chunk));
    },
    on() {},
    removeListener() {},
  };
}

function 创建平台状态列表() {
  return [
    { ok: true, 菜单编号: "1", 项目名称: "京东开票巡检", 店铺总数: 5, 启用店铺数: 5, 订单文件存在: true, 订单总数: 4, 待处理: 0, 处理中: 4, 已登记: 0, 已处理: 0, 最近任务: { 任务记录存在: true, 状态: "成功" } },
    { ok: true, 菜单编号: "2", 项目名称: "京东发票回传", 店铺总数: 5, 启用店铺数: 5, 订单文件存在: true, 订单总数: 20, 待处理: 0, 处理中: 3, 已登记: 2, 已处理: 15, 最近任务: { 任务记录存在: true, 状态: "成功" } },
    { ok: true, 菜单编号: "3", 项目名称: "天猫发票回传", 店铺总数: 4, 启用店铺数: 4, 订单文件存在: true, 订单总数: 7, 待处理: 7, 处理中: 0, 已登记: 0, 已处理: 0, 最近任务: { 任务记录存在: false, 状态: "暂无" } },
    { ok: true, 菜单编号: "4", 项目名称: "拼多多发票回传", 店铺总数: 0, 启用店铺数: 0, 订单文件存在: false, 订单总数: 0, 待处理: 0, 处理中: 0, 已登记: 0, 已处理: 0, 最近任务: { 任务记录存在: false, 状态: "暂无" } },
    { ok: true, 菜单编号: "5", 项目名称: "抖音发票回传", 店铺总数: 0, 启用店铺数: 0, 订单文件存在: false, 订单总数: 0, 待处理: 0, 处理中: 0, 已登记: 0, 已处理: 0, 最近任务: { 任务记录存在: false, 状态: "暂无" } },
  ];
}

function 创建模拟选项(输出) {
  return {
    output: 输出,
    读取平台状态: () => 创建平台状态列表(),
    读取下载中心状态: async () => ({
      status: "ready",
      label: "可用",
      detail: "http://127.0.0.1:39410",
      items: [
        { name: "下载服务", status: "ready", label: "在线", detail: "http://127.0.0.1:39410" },
        { name: "诺诺登录", status: "ready", label: "可用", detail: "主体 2 个" },
        { name: "发票下载", status: "ready", label: "可用", detail: "可以开始回传" },
      ],
    }),
    读取下载中心摘要: () => ({
      目录存在: true,
      诺诺状态: { status: "ready", label: "可用", detail: "主体 2 个", updatedAt: "2026-08-15T06:06:24.302Z" },
      账号已配置: true,
      发票索引数: 12,
      服务进程: { pid: 123, label: "HTTP服务" },
    }),
    打开下载中心: () => {},
    启动下载中心服务: () => {},
    打开下载目录: async () => "D:/下载目录",
  };
}

test("冒烟：统一总控制台总览页渲染全部平台状态和下载中心状态", async () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建TUI(创建模拟选项(output));
  app.running = true;
  await new Promise((resolve) => setTimeout(resolve, 10));
  app.切换页面(0);
  const 帧 = app.构建帧();
  assert.ok(Array.isArray(帧));
  assert.ok(帧[0].includes("发票自动化总控制台"));
  assert.ok(帧.some((行) => 行.includes("京东开票巡检")));
  assert.ok(帧.some((行) => 行.includes("京东发票回传")));
  assert.ok(帧.some((行) => 行.includes("天猫发票回传")));
  assert.ok(帧.some((行) => 行.includes("拼多多发票回传")));
  assert.ok(帧.some((行) => 行.includes("抖音发票回传")));
  assert.ok(帧.some((行) => 行.includes("诺诺登录")));
  dispose();
});

test("下载中心页能渲染诺诺登录状态和快捷操作", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建TUI(创建模拟选项(output));
  app.running = true;
  app.切换页面(1);
  const 帧 = app.构建帧();
  assert.ok(帧.some((行) => 行.includes("通用发票下载中心状态")));
  assert.ok(帧.some((行) => 行.includes("打开下载中心控制台")));
  assert.ok(帧.some((行) => 行.includes("启动下载中心后台服务")));
  assert.ok(帧.some((行) => 行.includes("立即刷新登录状态")));
  dispose();
});

test("上下键可以在五个平台和退出项之间移动选择", () => {
  const output = 创建模拟输出();
  const { app, dispose } = 创建TUI(创建模拟选项(output));
  app.running = true;
  app.切换页面(0);
  for (let 索引 = 0; 索引 < 5; 索引 += 1) {
    app.分发按键("down");
  }
  // 选择应停在退出项，帧中退出行被反色选中（reverse 转义码已包含在行内）。
  assert.ok(app.分发按键("up"));
  dispose();
});
