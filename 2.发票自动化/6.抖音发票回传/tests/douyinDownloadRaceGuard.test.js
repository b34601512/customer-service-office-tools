// 2026-09-18 实战沉淀：抖音「下载报表」的下载可能由**弹窗页面**承载，
// 承载页面被抖音自己关掉后，`download.saveAs` 会报
// “Target page, context or browser has been closed”（抖音店铺5 连续 2 次踩到）。
//
// 本测试把修法锁死：
//  ①下载监听必须在 **context 级**（谁发起的下载都算），不允许退回只盯某个 page；
//  ②拿到 download 后必须先落盘，再打日志（不给“页面被关”留窗口）；
//  ③落盘失败必须写全现场（文件名/来源地址/当前页面列表）+ 明确“未自动重试”。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const 源码路径 = path.resolve(__dirname, "../src/invoiceReturn/douyinInvoicePage.js");
const 源码 = fs.readFileSync(源码路径, "utf8");

test("抖音下载：必须在 context 级捕获下载（不许退回页面级）", () => {
  assert.match(源码, /context\.on\(['"]download['"]/, "必须用 context.on('download') 捕获下载");
  assert.doesNotMatch(
    源码,
    /page\.waitForEvent\(['"]download['"]/,
    "不允许再只盯某个 page 等下载（弹窗承载下载时会漏接/绑错页面）"
  );
});

test("抖音下载：拿到下载对象后立刻落盘，日志不得插在 saveAs 之前", () => {
  const 落盘段起点 = 源码.indexOf("async function 下载最新抖音导出报表");
  assert.ok(落盘段起点 > 0, "必须能找到下载落盘函数");
  const 段落 = 源码.slice(落盘段起点, 源码.indexOf("async function 导出抖音待回传订单", 落盘段起点));
  const saveAs位置 = 段落.indexOf("await download.saveAs(");
  const 日志位置 = 段落.indexOf("'正在保存抖音导出报表。'");
  assert.ok(saveAs位置 > 0, "必须调用 download.saveAs 落盘");
  assert.ok(日志位置 > saveAs位置, "“正在保存”日志必须在 saveAs 之后，避免多余 await 拉长竞态窗口");
  assert.match(段落, /catch \(保存错误\)/, "落盘失败必须显式捕获并留现场");
  assert.match(段落, /未自动重试/, "落盘失败时要说清“未自动重试”");
  assert.match(段落, /当前页面列表=/, "落盘失败的报错里必须带当前页面列表");
});

test("抖音下载：context 级捕获的行为正确（事件到达即完成，超时报错，上下文关闭即失败）", async () => {
  const { 捕获抖音下载 } = require("../src/invoiceReturn/douyinInvoicePage");

  // ① 事件到达 → 返回同一个下载对象
  {
    const 假上下文 = new EventEmitter();
    const 等待 = 捕获抖音下载(假上下文, { 超时毫秒: 1000 });
    const 假下载 = { suggestedFilename: () => "报表.xlsx" };
    假上下文.emit("download", 假下载);
    assert.strictEqual(await 等待, 假下载, "捕获到的下载对象必须原样返回");
    assert.strictEqual(假上下文.listenerCount("download"), 0, "拿到下载后必须摘掉监听，避免影响下一次下载");
  }

  // ② 超时 → 明确中文报错（不静默等待）
  {
    const 假上下文 = new EventEmitter();
    await assert.rejects(
      () => 捕获抖音下载(假上下文, { 超时毫秒: 1000 }),
      /1 秒内没有捕获到下载事件/,
      "等不到下载必须报错，不许无限等待"
    );
    assert.strictEqual(假上下文.listenerCount("download"), 0, "超时后也必须摘掉监听");
  }

  // ③ 上下文先关 → 立刻失败，不留悬空 Promise
  {
    const 假上下文 = new EventEmitter();
    const 等待 = 捕获抖音下载(假上下文, { 超时毫秒: 5000 });
    假上下文.emit("close");
    await assert.rejects(() => 等待, /浏览器上下文在下载开始前就被关闭/);
  }
});

test("抖音下载：现场读取函数不许因为页面已关而抛错（要退化成交付文本）", () => {
  const { 读取抖音下载现场 } = require("../src/invoiceReturn/douyinInvoicePage");
  const 已死的下载 = {
    suggestedFilename: () => {
      throw new Error("Target page, context or browser has been closed");
    },
    url: () => {
      throw new Error("Target page, context or browser has been closed");
    }
  };
  const 已死的页面 = { context: () => { throw new Error("closed"); } };
  const 现场 = 读取抖音下载现场(已死的下载, 已死的页面);
  assert.match(现场.文件名, /读取文件名失败/, "读文件名失败要退化说明，不能把原始错误盖掉");
  assert.match(现场.来源地址, /读取来源地址失败/);
  assert.match(现场.页面列表, /读取页面列表失败/);
});

test("抖音下载：原生落盘失败时必须能改用“直取字节”（不依赖页面存活）", async () => {
  const { 直取抖音下载字节 } = require("../src/invoiceReturn/douyinInvoicePage");
  const os = require("node:os");
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-dl-"));
  const 目标 = path.join(临时目录, "报表.xlsx");

  // ① 能取到字节 → 落盘成功
  {
    const 假上下文 = {
      request: {
        get: async (地址) => ({
          ok: () => true,
          status: () => 200,
          body: async () => Buffer.from("假报表字节" + 地址)
        })
      }
    };
    const 结果 = await 直取抖音下载字节({ url: () => "https://example.test/export.xlsx" }, 目标, { context: 假上下文 });
    assert.strictEqual(结果.ok, true, "直取字节应当成功");
    assert.ok(fs.existsSync(目标), "直取成功后必须真的落盘");
  }

  // ② 取不到地址 / 上下文已死 / HTTP 失败 → 明确失败原因（不抛未捕获异常）
  {
    const 读地址会抛 = { url: () => { throw new Error("Target page, context or browser has been closed"); } };
    const 结果一 = await 直取抖音下载字节(读地址会抛, 目标, { context: { request: { get: async () => ({}) } } });
    assert.strictEqual(结果一.ok, false);
    assert.match(结果一.原因, /取不到下载地址/);

    const 结果二 = await 直取抖音下载字节({ url: () => "https://example.test/x.xlsx" }, 目标, { context: null });
    assert.strictEqual(结果二.ok, false);
    assert.match(结果二.原因, /上下文已不可用/);

    const 假上下文 = {
      request: { get: async () => ({ ok: () => false, status: () => 403, body: async () => Buffer.alloc(0) }) }
    };
    const 结果三 = await 直取抖音下载字节({ url: () => "https://example.test/x.xlsx" }, 目标, { context: 假上下文 });
    assert.strictEqual(结果三.ok, false);
    assert.match(结果三.原因, /HTTP 403/);
  }
});

test("抖音下载：落盘不允许再出现“只靠 saveAs 一次、失败就算了”的老写法", () => {
  const 起点 = 源码.indexOf("async function 下载最新抖音导出报表");
  const 段落 = 源码.slice(起点, 源码.indexOf("async function 导出抖音待回传订单", 起点));
  assert.match(段落, /直取抖音下载字节/, "必须保留“直取字节”这条路，不能退回只靠 saveAs");
  assert.match(段落, /已改用直取字节保存/, "换路成功要有日志说明（便于日后统计发生率）");
});

// 2026-09-20 实锤：报表下载先走 HTTP `/order/invoice/download?task_id=...`（content-type application/download），
// 页面随后转成 blob 下载，并在 ~4 秒后自行关闭（page close → context close），saveAs 与 blob 直取双双失效。
// 修法：点击下载前就挂 context 级响应监听，响应一到就读字节；落盘不再依赖页面/blob 存活。本组测试锁死该行为。
test("抖音下载：报表响应按导出地址与 content-type 识别，不误收任务列表 JSON", () => {
  const { 是不是抖音报表响应 } = require("../src/invoiceReturn/douyinInvoicePage");
  assert.equal(是不是抖音报表响应("https://fxg.jinritemai.com/order/invoice/download?task_id=1", ""), true);
  assert.equal(是不是抖音报表响应("https://example.test/some-file", "application/download"), true);
  assert.equal(
    是不是抖音报表响应("https://example.test/x.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    true
  );
  assert.equal(
    是不是抖音报表响应("https://fxg.jinritemai.com/order/invoice/get_export_task_list?page=0", "application/json; charset=utf-8"),
    false,
    "导出任务列表 JSON 不能被当成报表"
  );
});

test("抖音下载：响应到达时就要抓住字节，并可按导出任务号挑选", async () => {
  const { 捕获抖音报表响应, 选取本次报表字节 } = require("../src/invoiceReturn/douyinInvoicePage");
  const 假上下文 = new EventEmitter();
  const 报表字节 = Buffer.from("PK-fake-xlsx-bytes");
  const 捕获 = 捕获抖音报表响应(假上下文);

  假上下文.emit("response", {
    url: () => "https://fxg.jinritemai.com/order/invoice/get_export_task_list?page=0",
    headers: () => ({ "content-type": "application/json; charset=utf-8" }),
    body: async () => Buffer.from("[]")
  });
  假上下文.emit("response", {
    url: () => "https://fxg.jinritemai.com/order/invoice/download?task_id=7687426398369202484&__token=x",
    headers: () => ({ "content-type": "application/download" }),
    body: async () => 报表字节
  });
  await 捕获.等待读取结束();

  const 命中列表 = 捕获.取命中列表();
  assert.equal(命中列表.length, 1, "只有真正的报表响应能被收下");
  assert.deepEqual(命中列表[0].字节, 报表字节, "响应到达时就要把字节读进内存");
  捕获.停止();
  assert.equal(假上下文.listenerCount("response"), 0, "收尾必须摘掉监听");

  const 选中 = 选取本次报表字节(
    命中列表,
    { suggestedFilename: () => "2026-09-20-order_invoice_export_task_id_7687426398369202484.xlsx" },
    0
  );
  assert.equal(选中, 命中列表[0], "必须按导出任务号精确挑中本次报表");
  assert.equal(选取本次报表字节([], { suggestedFilename: () => "x.xlsx" }), null, "没有命中时必须返回 null，交给后备路径");
});

test("抖音下载：落盘失败必须优先用同一次下载的响应字节，响应没有才退回 blob 直取", () => {
  const 起点 = 源码.indexOf("async function 下载最新抖音导出报表");
  const 段落 = 源码.slice(起点, 源码.indexOf("async function 导出抖音待回传订单", 起点));
  const 挂监听位置 = 段落.indexOf("捕获抖音报表响应(page.context())");
  const 点击位置 = 段落.indexOf("等待并点击抖音下载报表");
  const 响应命中位置 = 段落.indexOf("选取本次报表字节");
  const 直取位置 = 段落.indexOf("直取抖音下载字节");
  assert.ok(挂监听位置 > 0, "必须在下载动作前挂报表响应监听");
  assert.ok(挂监听位置 < 点击位置, "监听必须先于点击下载（页面几秒后就自关，晚了抓不到）");
  assert.ok(响应命中位置 > 0 && 响应命中位置 < 直取位置, "必须先尝试响应字节，再退回 blob 直取");
  assert.match(段落, /fs\.writeFileSync\(exportFilePath, 响应命中\.字节\)/, "命中响应时必须真的把字节写盘");
  assert.match(段落, /响应捕获\.停止\(\)/, "收尾必须停掉响应捕获，不留泄漏监听");
});
