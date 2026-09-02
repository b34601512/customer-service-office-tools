const test = require("node:test");
const assert = require("node:assert/strict");
const {
  压缩单行文本,
  规范化表格单元格文本,
  构建表头,
  构建表格行,
  构建订单镜像列表,
  过滤订单镜像列表,
  订单过滤模式,
  构建订单表格头,
  构建订单表格行,
  构建订单表格宽度方案,
} = require("./镜像表格");
const { 剥离ANSI, 显示宽度, 截断, 适配宽度 } = require("./width");

test("终端宽度：完整字形只计算一次，歧义标点按一列", () => {
  assert.equal(显示宽度("e\u0301"), 1);
  assert.equal(显示宽度("👍🏽"), 2);
  assert.equal(显示宽度("👩🏽‍💻"), 2);
  assert.equal(显示宽度("…—→"), 3);
  assert.equal(显示宽度("\x1b[31m客户\x1b[0m"), 4);
  assert.equal(剥离ANSI(截断("👩🏽‍💻ABC", 3)), "👩🏽‍💻…");

  const 彩色结果 = 适配宽度("\x1b[31m👩🏽‍💻e\u0301客户XYZ\x1b[0m", 8);
  assert.equal(显示宽度(彩色结果), 8);
  assert.match(彩色结果, /\x1b\[0m…$/);
});

test("终端表格：特殊昵称不改变后续分隔符位置", () => {
  const 列定义 = [
    { 标题: "#", 宽度: 4 },
    { 标题: "客户", 宽度: 8 },
    { 标题: "状态", 宽度: "flex" },
  ];
  const 行列表 = [
    构建表头(列定义, 28),
    构建表格行(列定义, [{ 文本: "1" }, { 文本: "👩🏽‍💻e\u0301" }, { 文本: "处理中" }], 28),
    构建表格行(列定义, [{ 文本: "2" }, { 文本: "普通客户" }, { 文本: "完成" }], 28),
  ];
  const 分隔位置 = (行) => {
    const 原文 = 剥离ANSI(行);
    return [...原文.matchAll(/│/g)].map((匹配) => 显示宽度(原文.slice(0, 匹配.index)));
  };
  assert.deepEqual(分隔位置(行列表[0]), 分隔位置(行列表[1]));
  assert.deepEqual(分隔位置(行列表[1]), 分隔位置(行列表[2]));
});

test("镜像表格：表头和数据行使用固定列宽和动态剩余列", () => {
  const 列定义 = [
    { 标题: "#", 宽度: 4 },
    { 标题: "订单号", 宽度: 10 },
    { 标题: "消息", 宽度: "flex" },
  ];
  const 表头 = 构建表头(列定义, 30);
  assert.ok(表头.includes("#"));
  assert.ok(表头.includes("订单号"));
  assert.ok(表头.includes("消息"));
  const 行 = 构建表格行(列定义, [
    { 文本: "1" },
    { 文本: "1001" },
    { 文本: "下载失败", 颜色: "brightRed" },
  ], 30);
  assert.ok(行.includes("1001"));
  assert.ok(行.includes("下载失败"));
  assert.ok(行.includes("\x1b[91m"));
});

test("订单镜像：工作流状态优先排序，需关注过滤只看待处理/处理中/失败", () => {
  const 列表 = 构建订单镜像列表([
    { key: "s1:o3", storeId: "s1", storeName: "A店", orderNumber: "1003", workflowStatus: "handled", platformStatus: { text: "已上传", kind: "success" }, lastReturnAttempt: { status: "success" } },
    { key: "s1:o1", storeId: "s1", storeName: "A店", orderNumber: "1001", workflowStatus: "pending", platformStatus: { text: "可录入", kind: "returnable" }, lastReturnAttempt: { status: "error", message: "登录失效" } },
    { key: "s1:o2", storeId: "s1", storeName: "A店", orderNumber: "1002", workflowStatus: "invoice_registered", platformStatus: { text: "可录入", kind: "returnable" } },
    { key: "s1:o4", storeId: "s1", storeName: "A店", orderNumber: "1004", workflowStatus: "processing", platformStatus: { text: "开票成功", kind: "success" }, lastReturnAttempt: { status: "error", message: "不应继续回传" } },
  ]);
  assert.equal(列表[0].orderNumber, "1001");
  assert.equal(列表[1].orderNumber, "1004");
  assert.equal(列表[2].orderNumber, "1002");
  assert.equal(列表[3].orderNumber, "1003");

  const 需关注 = 过滤订单镜像列表(列表, 0);
  assert.equal(需关注.length, 1);
  assert.equal(需关注[0].orderNumber, "1001");
  assert.equal(需关注.some((订单) => 订单.orderNumber === "1004"), false);
  assert.equal(订单过滤模式[0].label, "需关注");
});

test("订单表格行：把订单镜像渲染成客户页风格的固定列", () => {
  const 行 = 构建订单表格行(0, {
    orderNumber: "12345678901234567890",
    storeName: "A店",
    platformText: "可录入发票",
    platformKind: "returnable",
    workflowText: "待处理",
    workflowStatus: "pending",
    returnText: "失败",
    returnStatus: "error",
    detectedText: "2026-08-18",
    lastMessage: "下载失败：诺诺登录态已失效",
  }, 120);
  assert.ok(行.includes("12345678901234567890"));
  assert.ok(行.includes("A店"));
  assert.ok(行.includes("可录入发票"));
  assert.ok(行.includes("待处理"));
  assert.ok(行.includes("失败"));
  assert.ok(行.includes("2026-08-18"));
  assert.ok(行.includes("诺诺登录态已失效"));
});

test("订单表格：按整批数据计算列宽，表头与每一行分隔符位置一致", () => {
  const 扩展列 = [
    { 标题: "申请日期", 宽度: 12, 取值: (镜像) => 镜像.原订单?.invoiceApplyTime || "-" },
    { 标题: "后台状态", 宽度: 16, 取值: (镜像) => 镜像.原订单?.operationStatus || "-" },
  ];
  const 镜像列表 = [
    {
      orderNumber: "6928868737299505125",
      storeName: "抖音店铺5",
      platformText: "已完成｜发货",
      platformKind: "returnable",
      workflowText: "待处理",
      workflowStatus: "pending",
      returnText: "下载中",
      returnStatus: "downloading",
      detectedText: "2026-08-21",
      lastMessage: "下载中心正在处理第 1/2 张发票，已等待 0 秒。通常 30 秒内返回…",
      原订单: { invoiceApplyTime: "2026-08-17", operationStatus: "-" },
    },
    {
      orderNumber: "6955285753597728687",
      storeName: "抖音店铺5",
      platformText: "已发货｜发票",
      platformKind: "returnable",
      workflowText: "待处理",
      workflowStatus: "pending",
      returnText: "等待",
      returnStatus: "queued",
      detectedText: "2026-08-21",
      lastMessage: "等待回传",
      原订单: { invoiceApplyTime: "2026-08-18", operationStatus: "-" },
    },
  ];
  const 宽度方案 = 构建订单表格宽度方案(180, 扩展列, 镜像列表);
  const 行列表 = [
    构建订单表格头(180, 扩展列, 宽度方案),
    ...镜像列表.map((镜像, 索引) => 构建订单表格行(索引, 镜像, 180, 扩展列, 宽度方案)),
  ];
  const 分隔位置 = (行) => {
    const 原文 = 剥离ANSI(行);
    return [...原文.matchAll(/│/g)].map((匹配) => 显示宽度(原文.slice(0, 匹配.index)));
  };
  assert.deepEqual(分隔位置(行列表[0]), 分隔位置(行列表[1]));
  assert.deepEqual(分隔位置(行列表[1]), 分隔位置(行列表[2]));
  assert.match(剥离ANSI(行列表[1]), /抖音店铺5│已完成 · 发货/);
  assert.doesNotMatch(剥离ANSI(行列表[1]), /已完成｜发货|已完成\|发货/);
  assert.doesNotMatch(剥离ANSI(行列表[1]), /抖音店铺5…/);
});

test("订单表格：清理后台旧省略号，统一把省略号放在当前列边界", () => {
  const 扩展列 = [
    { 标题: "后台状态", 宽度: 12, 取值: (镜像) => 镜像.原订单?.operationStatus || "-" },
  ];
  const 镜像 = {
    orderNumber: "1001",
    storeName: "抖音店铺5 DEDAK医疗器械专营店...",
    platformText: "已发货｜发票：待开票...",
    platformKind: "returnable",
    workflowText: "待处理",
    workflowStatus: "pending",
    returnText: "跳过",
    returnStatus: "skipped",
    detectedText: "2026-08-21",
    lastMessage: "已跳过：下载中心没有找到可下载发票。诺诺发票系统...",
    原订单: { operationStatus: "页面状态..." },
  };
  const 宽度方案 = 构建订单表格宽度方案(120, 扩展列, [镜像]);
  const 行 = 剥离ANSI(构建订单表格行(0, 镜像, 120, 扩展列, 宽度方案));
  assert.equal(规范化表格单元格文本("状态｜已发货..."), "状态 · 已发货");
  assert.doesNotMatch(行, /\.\.\./);
  assert.doesNotMatch(行, /已发货｜|已发货\|/);
  assert.match(行, /│/);
});

test("订单镜像：识别日期优先取 addedAt，缺字段回退更新时间并转成本地日期", () => {
  const [镜像1, 镜像2] = 构建订单镜像列表([
    { key: "s1:o1", storeId: "s1", storeName: "A店", orderNumber: "1001", workflowStatus: "pending", addedAt: "2026-08-18T12:00:00.000Z", updatedAt: "2026-08-18T03:00:00.000Z", platformStatus: { text: "可录入", kind: "returnable" } },
    { key: "s1:o2", storeId: "s1", storeName: "A店", orderNumber: "1002", workflowStatus: "pending", updatedAt: "2026-08-17T12:00:00.000Z", platformStatus: { text: "可录入", kind: "returnable" } },
  ]);
  assert.equal(镜像1.detectedText, "2026-08-18");
  assert.equal(镜像2.detectedText, "2026-08-17");
  const 无日期镜像 = 构建订单镜像列表([
    { key: "s1:o3", storeId: "s1", storeName: "A店", orderNumber: "1003", workflowStatus: "pending", platformStatus: { text: "可录入", kind: "returnable" } },
  ])[0];
  assert.equal(无日期镜像.detectedText, "");
  const 行 = 构建订单表格行(0, 无日期镜像, 100);
  assert.ok(行.includes("-"));
});

test("压缩单行文本：把多行和连续空白压成单行", () => {
  assert.equal(压缩单行文本(" 第一行\n第二行\t结束 "), "第一行 第二行 结束");
});
