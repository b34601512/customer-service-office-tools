// 「拼多多·平台同意退款」工具的单测：只测纯逻辑，不连浏览器。
// 2026-09-30：起因是经验文档原先写“面板数字查不到对应单”，实测有 operateType=2 筛选，遂落成工具；
// 这里锁死「近 N 小时窗口」的判断，防止以后改坏（把这个数字和面板对齐的唯一依据）。
const test = require("node:test");
const assert = require("node:assert/strict");
const { 筛选近内关闭, 解释actions } = require("../src/tools/pdd-platform-refund-orders");

const 现在 = Date.parse("2026-09-30T16:40:00+08:00");

test("窗口内、边界、窗口外：只挑近 24h 内关闭的单", () => {
  const list = [
    { orderSn: "今天下午", closeTime: Date.parse("2026-09-30T14:35:25+08:00") },
    { orderSn: "昨晚", closeTime: Date.parse("2026-09-29T21:05:37+08:00") },
    { orderSn: "刚好24h前", closeTime: 现在 - 24 * 3600 * 1000 },
    { orderSn: "25h前", closeTime: 现在 - 25 * 3600 * 1000 },
    { orderSn: "还没关", closeTime: 0 },
    { orderSn: "字段缺失" },
  ];
  const 命中 = 筛选近内关闭(list, 24, 现在).map((x) => x.orderSn);
  assert.deepEqual(命中, ["今天下午", "昨晚", "刚好24h前"]);
});

test("解释 actions：1000=秒退、1028=超时自动退", () => {
  assert.match(解释actions([1000]), /秒退/);
  assert.match(解释actions([1028]), /超时自动退/);
  assert.equal(解释actions([]), "无");
  assert.equal(解释actions(undefined), "无");
});

test("反向断言：工具里必须用 operateType=2（平台同意退款）这个筛选，别退化成拉全量人工核", () => {
  const 源码 = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "tools", "pdd-platform-refund-orders.js"), "utf8");
  assert.match(源码, /operateType:\s*2/, "查询必须带 operateType: 2");
  assert.ok(!/afterSalesStatusList/.test(源码), "不该再用「拉全量退款成功再人工核」的旧办法");
});
