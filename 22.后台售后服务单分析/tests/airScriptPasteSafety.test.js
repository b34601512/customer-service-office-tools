// 反向断言：把「粘贴通道会吃等号」这件事锁死，防止以后有人把等号比较加回来。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("node:vm");

const SCRIPT_PATH = path.join(__dirname, "..", "kdocs-scripts", "AirScript-只读查询订单号.md");

function readScript() {
  return fs.readFileSync(SCRIPT_PATH, "utf8");
}
function stripComments(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, "")).join("\n");
}

test("脚本不许出现等号比较（粘贴进金山会吃掉等号序列：=== 变 =、== 消失、>= 可能变 >）", () => {
  const offenders = stripComments(readScript())
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter((item) => /[=!<>]=/.test(item.line));
  assert.deepEqual(offenders.map((item) => `${item.number}: ${item.line}`), []);
});

test("脚本只读：不出现任何写操作", () => {
  const code = stripComments(readScript());
  for (const banned of ["ClearContents", ".Save(", ".Add(", ".Activate(", ".Delete(", "Value2 ="]) {
    assert.ok(!code.includes(banned), `脚本里出现了写操作：${banned}`);
  }
});

test("脚本只用保守语法（本地可解析；不用模板字符串和箭头函数）", () => {
  const code = stripComments(readScript());   // 只看代码：说明性注释里允许出现这些符号
  assert.doesNotThrow(() => new vm.Script(readScript()), "脚本本地语法不通过");
  assert.ok(!code.includes("=>"), "不许用箭头函数");
  assert.ok(!code.includes("`"), "不许用模板字符串");
});
