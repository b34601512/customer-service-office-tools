// 提交闸门（tools/提交.js）的反向断言测试。
// 跑：node --test tools/提交.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { 解析未学数, 解析参数 } = require("./提交.js");

test("解析未学数：认得扫描输出里的两种写法", () => {
  assert.equal(解析未学数("合计 53 个真值，其中 8 个还没进对照表。"), 8);
  assert.equal(解析未学数("合计 45 个真值，其中 0 个还没进对照表。"), 0);
  assert.equal(解析未学数("乱七八糟没有这句话"), 0);
});

test("解析参数：必须点名文件（禁止 git add -A / -u 那种批量）", () => {
  assert.throws(() => 解析参数(["-m", "x"]), /必须点名/);
  assert.throws(() => 解析参数(["a.md"]), /缺少提交信息/);
  assert.throws(() => 解析参数(["-m", "x", "-A"]), /不认识的参数/);
  assert.throws(() => 解析参数(["-m", "x", "-u"]), /不认识的参数/);
});

test("解析参数：正常用法", () => {
  const r = 解析参数(["-m", "提交信息", "a.md", "b/c.js"]);
  assert.equal(r.信息, "提交信息");
  assert.deepEqual(r.文件, ["a.md", "b/c.js"]);
});

test("反向断言：脚本源码里不许出现批量 add（git add -A / -u / add .）", () => {
  const 源码 = fs.readFileSync(path.join(__dirname, "提交.js"), "utf8");
  assert.ok(!/add",\s*"-A"/.test(源码), "不许 git add -A");
  assert.ok(!/add",\s*"-u"/.test(源码), "不许 git add -u");
  assert.ok(!/add",\s*"\."/.test(源码), "不许 git add .");
  assert.ok(/--renormalize/.test(源码), "必须用 --renormalize 让打码过滤器重新生效");
  assert.ok(/--学/.test(源码), "扫描出未进对照表的真值时必须先 --学");
});
