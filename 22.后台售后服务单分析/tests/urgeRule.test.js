// 反向断言（2026-09-22 用户拍板的“全平台通用催促原则”锁死）：
// 树只有一棵 —— 先看签收，再看金山退货表，最后才看 24 小时。
// 特别锁死两件曾经出过事的行为：读不到签收不许判“无漏”，表里没登记不许说“已登记”。
const test = require("node:test");
const assert = require("node:assert");
const { 判定退货催促, 退货催促话术, 签收超时小时 } = require("../src/tools/urge-rule");

const 时 = (h) => new Date(Date.now() - h * 3600000).toISOString();

test("未签收（在途）→ 不催", () => {
  const r = 判定退货催促({ 签收状态: "in_transit", 退货表: "未登记", 平台退款: "未退款" });
  assert.strictEqual(r.催, false);
  assert.strictEqual(r.分支, "未签收-在途");
});

test("签收状态读不到 → 不许判无漏，必须停下来要人看", () => {
  for (const 状态 of ["unknown", undefined, null, ""]) {
    const r = 判定退货催促({ 签收状态: 状态, 退货表: "未登记", 平台退款: "未退款" });
    assert.strictEqual(r.催, false, "没签收信息时不下催的结论");
    assert.strictEqual(r.需人工, true, "必须标需人工");
    assert.match(r.理由, /待确认签收/);
  }
});

test("已签收 + 表里有 + 平台没退款 → 催（含表里标“已退款”但平台还挂着）", () => {
  for (const 表 of ["已登记", "已退款"]) {
    const r = 判定退货催促({ 签收状态: "signed", 签收时间: 时(2), 退货表: 表, 平台退款: "未退款" });
    assert.strictEqual(r.催, true, `${表} 都要催`);
    assert.strictEqual(r.分支, "表里有+平台未退款");
  }
});

test("已签收 + 表里有 + 平台已退款 → 不催", () => {
  const r = 判定退货催促({ 签收状态: "signed", 签收时间: 时(50), 退货表: "已退款", 平台退款: "已退款" });
  assert.strictEqual(r.催, false);
  assert.strictEqual(r.分支, "表里有+平台已退款");
});

test("表里没有：签收超过 24 小时 → 催；不到 24 小时 → 不催（边界正好 24 小时不催）", () => {
  const 超了 = 判定退货催促({ 签收状态: "signed", 签收时间: 时(24.5), 退货表: "未登记", 平台退款: "未退款" });
  assert.strictEqual(超了.催, true);
  const 没超 = 判定退货催促({ 签收状态: "signed", 签收时间: 时(23.5), 退货表: "未登记", 平台退款: "未退款" });
  assert.strictEqual(没超.催, false);
  const 正好 = 判定退货催促({ 签收状态: "signed", 签收时间: 时(签收超时小时), 退货表: "未登记", 平台退款: "未退款" });
  assert.strictEqual(正好.催, false, "正好 24 小时按“没超”算");
});

test("签收时间读不到 → 不催且要人看（不许当成刚签收/签收已久）", () => {
  for (const 时间 of [null, "", "乱码"]) {
    const r = 判定退货催促({ 签收状态: "signed", 签收时间: 时间, 退货表: "未登记", 平台退款: "未退款" });
    assert.strictEqual(r.催, false);
    assert.strictEqual(r.需人工, true);
    assert.strictEqual(r.分支, "签收时间缺失");
  }
});

test("平台已退款时一律不催（不管登记表有没有）", () => {
  assert.strictEqual(判定退货催促({ 签收状态: "signed", 签收时间: 时(99), 退货表: "未登记", 平台退款: "已退款" }).催, false);
  assert.strictEqual(判定退货催促({ 签收状态: "signed", 签收时间: 时(99), 退货表: "已登记", 平台退款: "已退款" }).催, false);
});

test("话术：表里没登记就不许出现“已登记”，表里有登记才说“已登记”", () => {
  const 没登记 = 退货催促话术({ 签收时间: 时(1), 退货表: "未登记" });
  assert.doesNotMatch(没登记, /已登记/, "表里没登记绝不能说已登记");
  assert.match(没登记, /确认收货并登记退货表/);
  const 有登记 = 退货催促话术({ 签收时间: 时(1), 退货表: "已登记" });
  assert.match(有登记, /退款表已登记/);
  assert.match(有登记, /尽快给客户退款/);
});

test("默认阈值必须是 24 小时（口径改了要改这里，不许散在各平台里）", () => {
  assert.strictEqual(签收超时小时, 24);
});
