// 反向断言：天猫登录自动填充的账号必须是**整串**「主账号:子账号」，且找不到店时不许拿别家店顶替。
// 现场（2026-09-30 用户原话「你填的啥，完全不对，跟隔壁的都不一样」）：旧代码 split(':').pop()
// 把「德达旗舰店:小黛」填成了「小黛」，而 9号/12号 都是整串填。
const test = require("node:test");
const assert = require("node:assert");

const { 读账号 } = require("../src/tools/tmall-autofill-login.js");

const 假配置 = [
  { 来源: "9号", 店铺: [{ key: "tmall1", username: "德达旗舰店:小黛", password: "p1" }] },
  { 来源: "12号", 店铺: [{ key: "tmall6", username: "德迩杰旗舰店:小黛", password: "p6" }] },
];

test("账号必须原样整串填（含冒号），不许切一半", () => {
  const 结果 = 读账号("tmall1", 假配置);
  assert.equal(结果.账号, "德达旗舰店:小黛");
  assert.ok(结果.账号.includes(":"), "必须保留「主账号:子账号」的冒号");
  assert.equal(结果.密码, "p1");
});

test("9号没有的店（tmall6）走 12号配置，仍取整串", () => {
  const 结果 = 读账号("tmall6", 假配置);
  assert.equal(结果.账号, "德迩杰旗舰店:小黛");
  assert.match(结果.来源, /12号/);
});

test("两家配置都没有该店时抛错，不拿别家店账号顶替（串店=事故）", () => {
  assert.throws(() => 读账号("tmall9", 假配置), /不拿别家店的账号顶替/);
});

test("配置里账号或密码为空时报错", () => {
  assert.throws(
    () => 读账号("tmall1", [{ 来源: "9号", 店铺: [{ key: "tmall1", username: "德达旗舰店:小黛", password: "" }] }]),
    /账号或密码为空/
  );
});
