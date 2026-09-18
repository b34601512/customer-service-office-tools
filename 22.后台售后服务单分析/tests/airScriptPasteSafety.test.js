// 反向断言：把「粘贴通道会吃等号」「金山必须顶层 return」这两件事锁死，防止以后有人改回去。
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
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("脚本不许出现等号比较（粘贴进金山会吃掉等号序列：三连变单个、双连消失、大于等于可能变大于）", () => {
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
  const text = readScript();
  const code = stripComments(text);   // 说明性注释里允许出现这些符号
  // 金山允许顶层 return，Node 的 vm 不允许 → 做本地语法检查时把末行等价改写掉
  const syntaxSafeText = text.replace(/^return main\(\)$/m, "main()");
  assert.doesNotThrow(() => new vm.Script(syntaxSafeText), "脚本本地语法不通过");
  assert.ok(!code.includes("=>"), "不许用箭头函数");
  assert.ok(!code.includes("`"), "不许用模板字符串");
});

test("脚本末行必须是顶层 return main()（只写 main() 时金山拿不到返回值，实测 data.result 为 null）", () => {
  const lines = stripComments(readScript())
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(lines[lines.length - 1], "return main()");
});
