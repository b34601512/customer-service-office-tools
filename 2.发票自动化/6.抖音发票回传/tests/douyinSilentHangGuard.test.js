// 2026-09-20 静默卡死（首次实锤）：店铺3 回传阶段卡在「待开票列表」13 分钟，无输出无报错；
// 现场截屏显示页面完全正常、无滑块、无登录页 → 说明卡在 r 用无上限的 Playwright 调用
// （page.evaluate / evaluateAll / keyboard，渲染进程无响应时永不返回，循环里写的超时判断走不到）。
// 本组测试把「这类调用必须有墙钟上限、超时必须抛错/兜底，不许悬挂」锁死。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const 源码 = fs.readFileSync(path.join(__dirname, "..", "src", "invoiceReturn", "douyinInvoicePage.js"), "utf8");

test("限时等待：永不返回的调用必须按墙钟上限报错（不许悬挂）", async () => {
  const { 限时等待 } = require("../src/browser/dynamicWait");
  const 永不返回 = new Promise(() => {});
  const 开始时间 = Date.now();
  await assert.rejects(
    限时等待(永不返回, { 超时毫秒: 60, 说明: "测试求值" }),
    /测试求值超过墙钟上限 60 毫秒仍未返回/,
    "卡住时必须抛带现场的错，而不是永远等下去"
  );
  assert.ok(Date.now() - 开始时间 < 2000, "超时必须在有限时间内生效");

  assert.equal(await 限时等待(Promise.resolve("ok"), { 超时毫秒: 1000 }), "ok", "正常返回不受影响");
  await assert.rejects(限时等待(Promise.reject(new Error("真实错误")), { 超时毫秒: 1000 }), /真实错误/, "原始错误要透传");
});

test("关闭抖音非业务浮层：页面求值卡死时按上限兜底返回，不拖住等待循环", async () => {
  const { 关闭抖音非业务浮层 } = require("../src/invoiceReturn/douyinInvoicePage");
  const 卡死页面 = {
    keyboard: { press: () => new Promise(() => {}) },
    evaluate: () => new Promise(() => {}),
  };
  const 开始时间 = Date.now();
  const 结果 = await 关闭抖音非业务浮层(卡死页面, { 按键超时毫秒: 50, 求值超时毫秒: 50 });
  assert.deepEqual(结果, [], "卡死时必须兜底成空数组，让外层等待循环能继续判断状态");
  assert.ok(Date.now() - 开始时间 < 2000, "兜底必须在有限时间内完成");
});

test("检测抖音滑块验证：evaluateAll 卡死时按上限返回 false，不拖住等待循环", async () => {
  const { 检测抖音滑块验证 } = require("../src/invoiceReturn/douyinInvoicePage");
  const 卡死页面 = {
    locator: () => ({
      innerText: async () => "正常页面文本",
      evaluateAll: () => new Promise(() => {}),
    }),
  };
  const 开始时间 = Date.now();
  assert.equal(await 检测抖音滑块验证(卡死页面, { 求值超时毫秒: 50 }), false);
  assert.ok(Date.now() - 开始时间 < 2000, "兜底必须在有限时间内完成");
});

test("待开票等待路径：页面求值/键盘调用必须全部包在墙钟上限里（禁止裸调用回退）", () => {
  const 浮层起点 = 源码.indexOf("async function 关闭抖音非业务浮层");
  const 滑块起点 = 源码.indexOf("async function 检测抖音滑块验证");
  const 循环起点 = 源码.indexOf("async function 等待抖音待开票列表或登录页");
  assert.ok(浮层起点 > 0 && 滑块起点 > 浮层起点 && 循环起点 > 滑块起点, "函数位置必须能定位");

  const 浮层段 = 源码.slice(浮层起点, 滑块起点);
  const 滑块段 = 源码.slice(滑块起点, 循环起点);

  assert.match(浮层段, /限时等待\(page\.keyboard\.press\(/, "键盘调用必须限时");
  assert.match(浮层段, /限时等待\(page\.evaluate\(/, "关浮层求值必须限时");
  assert.equal(
    (浮层段.match(/page\.evaluate\(/g) || []).length,
    (浮层段.match(/限时等待\(page\.evaluate\(/g) || []).length,
    "不允许存在没包上限的 page.evaluate"
  );
  assert.match(滑块段, /限时等待\(page\.locator\(滑块组件选择器\)\.evaluateAll\(/, "滑块检测求值必须限时");
});
