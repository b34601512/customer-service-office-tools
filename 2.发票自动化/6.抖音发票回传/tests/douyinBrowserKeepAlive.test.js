// 2026-09-20 实锤：抖音报表页会自行关闭；它是最后一个页签时整个 Edge 窗口退出（非正常退出 → cookie 未落盘），
// 下一次启动直接回登录页，用户当天被迫重收 3 次短信。修法：每个浏览器上下文保留一个常驻保活页。
// 本组测试锁死：①保活页不许被“收敛页签”关掉；②保活页创建必须幂等、优先复用现有空白页；③启动流程必须建保活页。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { 关闭多余抖音页面, 确保常驻保活页, 是常驻保活页 } = require("../src/browser/douyinBrowserContext");

function 造页面(url = "about:blank") {
  const page = {
    url: () => url,
    isClosed: () => page.__closed === true,
    close: async () => { page.__closed = true; },
    goto: async (目标) => { url = 目标; },
  };
  return page;
}

test("关闭多余抖音页面：普通多余页要关，常驻保活页绝不能关", async () => {
  const 目标业务页 = 造页面("https://fxg.jinritemai.com/ffa/morder/receipt/list");
  const 多余页 = 造页面("https://fxg.jinritemai.com/x");
  const 保活页 = 造页面("about:blank");
  是常驻保活页(保活页) // 仅调用不报错（未被标记时应为 false）
  const 假上下文 = { pages: () => [目标业务页, 多余页, 保活页], newPage: async () => 造页面() };
  const 保活页引用 = await 确保常驻保活页(假上下文);
  const 空白保活页 = 保活页 === 保活页引用 ? 保活页 : 保活页引用;

  await 关闭多余抖音页面(假上下文.pages(), 目标业务页);
  assert.equal(多余页.__closed, true, "普通多余页必须关掉");
  assert.equal(目标业务页.__closed, undefined, "保留页面不能关");
  assert.notEqual(空白保活页.__closed, true, "保活页被关掉就又会回到“最后一个页签自关→浏览器退出”");
});

test("确保常驻保活页：优先标记现有空白页、重复调用不重复建页", async () => {
  const 空白页 = 造页面("about:blank");
  let 建页次数 = 0;
  const 假上下文 = {
    pages: () => [空白页],
    newPage: async () => { 建页次数 += 1; return 造页面("about:blank"); },
  };
  const 第一页 = await 确保常驻保活页(假上下文);
  const 第二页 = await 确保常驻保活页(假上下文);
  assert.equal(第一页, 空白页, "应该直接复用现有空白页");
  assert.equal(第二页, 第一页, "重复调用必须幂等");
  assert.equal(建页次数, 0, "有空白页就不该再建新页");
  assert.equal(是常驻保活页(第一页), true, "标记后必须认得出来");

  const 无空白页上下文 = { pages: () => [造页面("https://fxg.jinritemai.com/ffa")], newPage: async () => { 建页次数 += 1; return 造页面("about:blank"); } };
  await 确保常驻保活页(无空白页上下文);
  assert.equal(建页次数, 1, "没有空白页时必须补建一个保活页");
});

test("启动流程必须建常驻保活页（源码反向断言，禁止回退）", () => {
  const 源码 = fs.readFileSync(path.join(__dirname, "..", "src", "browser", "douyinBrowserContext.js"), "utf8");
  const 起点 = 源码.indexOf("async function 创建抖音账号浏览器上下文");
  const 段落 = 源码.slice(起点, 源码.indexOf("function 页面已关闭", 起点));
  assert.match(段落, /await 确保常驻保活页\(context\)/, "每次启动浏览器都必须确保有常驻保活页");
  assert.match(段落, /catch\(/, "保活页失败不能阻断主流程");
});
