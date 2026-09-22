// 反向断言（2026-09-22 实测事故锁死）：
// pdd-aftersale-overview.js 里三处正则原先写成正则字面量的 `\\s` / `\\d`（= 字面反斜杠+字母），
// 导致「最紧倒计时」「投诉预警原文」「首页卡片兜底」永远解析不出来（落盘恒 undefined/null），
// 而页面文本明明就有这些内容。以下用**当天真实页面原文**当样本，锁死“必须能解析出来”。
const test = require("node:test");
const assert = require("node:assert");
const {
  解析计数, 解析投诉预警原文, 解析倒计时分钟列表, 解析首页卡片
} = require("../src/tools/pdd-aftersale-overview");

// 2026-09-22 11:52 pdd02 售后工作台原文片段
const 真实列表原文 = "（0天23时3分45秒未处理，系统将自动退款） 联系消费者 德达家用制氧机 实收：¥498.00 退款：¥498.00 （0天23时3分48秒未处理，系统将自动退款）";
// 2026-09-18 实测过的投诉预警原文
const 真实投诉原文 = "因客服未及时帮消费者解决问题，有1笔售后单存在投诉风险，如消费者发起投诉，平台将介入处理";

test("倒计时必须能从真实列表文本解析出来（原来恒为空）", () => {
  const minutes = 解析倒计时分钟列表(真实列表原文);
  assert.strictEqual(minutes.length, 2, "两条倒计时都要抓到");
  assert.ok(Math.abs(minutes[0] - (23 * 60 + 3 + 45 / 60)) < 0.01, `0天23时3分45秒 应≈1383.75 分钟，实得 ${minutes[0]}`);
});

test("投诉预警原文必须能解析出来（原来恒为 undefined）", () => {
  const text = 解析投诉预警原文(真实投诉原文);
  assert.match(text, /有1笔售后单存在投诉风险/);
  assert.strictEqual(解析投诉预警原文("没有任何提示"), "");
});

test("顶部/筛选计数：带“单”和不带“单”两种口径都要读对", () => {
  const page = "24小时内将逾期订单数 2单 24小时内待商家举证 0单 投诉预警0 待处理即将逾期2 待商家处理16";
  assert.strictEqual(解析计数(page, "24小时内将逾期订单数", { 带单: true }), 2);
  assert.strictEqual(解析计数(page, "24小时内待商家举证", { 带单: true }), 0, "0 是真·没有，不许变 null");
  assert.strictEqual(解析计数(page, "投诉预警"), 0);
  assert.strictEqual(解析计数(page, "待处理即将逾期"), 2);
  assert.strictEqual(解析计数(page, "根本不存在的标签"), null, "读不到就是 null，不许编 0");
});

test("首页卡片兜底必须能解析（原来整块恒 null）", () => {
  const home = "售后过期预警 0 退款/售后 8 待处理工单 3 即将逾期发货 1";
  assert.deepStrictEqual(解析首页卡片(home), { "售后过期预警": 0, "退款/售后": 8, "待处理工单": 3, "即将逾期发货": 1 });
  assert.deepStrictEqual(解析首页卡片(""), { "售后过期预警": null, "退款/售后": null, "待处理工单": null, "即将逾期发货": null });
});
