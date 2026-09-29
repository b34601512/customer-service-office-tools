// 反向断言：把「粘贴进金山会吃等号」「金山必须顶层 return main()」「脚本只读」「纯 ASCII」锁死，
// 防止以后有人"顺手优化"把这些坑改回来。规则来自 22号 tests/airScriptPasteSafety.test.js 的实测结论。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const SCRIPTS_DIR = path.join(__dirname, '..', 'kdocs-scripts');

function listScripts() {
  return fs.readdirSync(SCRIPTS_DIR).filter((name) => name.endsWith('.md')).map((name) => path.join(SCRIPTS_DIR, name));
}
function readScript(file) {
  return fs.readFileSync(file, 'utf8');
}
function stripComments(text) {
  return text.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

test('至少有一个脚本（否则断言会变成空转）', () => {
  assert.ok(listScripts().length > 0);
});

test('不许出现双字符比较（== != >= <= 会被粘贴通道吃掉）', () => {
  for (const file of listScripts()) {
    const offenders = stripComments(readScript(file))
      .split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter((item) => /[=!<>]=/.test(item.line));
    assert.deepEqual(offenders.map((item) => `${path.basename(file)}:${item.number} ${item.line}`), []);
  }
});

test('只读：不许出现任何写操作/激活/保存', () => {
  for (const file of listScripts()) {
    const code = stripComments(readScript(file));
    for (const banned of ['ClearContents', '.Save(', '.Add(', '.Activate(', '.Delete(', 'Value2 =', 'Cells(']) {
      assert.ok(!code.includes(banned), `${path.basename(file)} 里出现了写操作：${banned}`);
    }
  }
});

test('只用保守语法：不许箭头函数、不许模板字符串，本地可解析', () => {
  for (const file of listScripts()) {
    const text = readScript(file);
    const code = stripComments(text);
    const syntaxSafeText = text.replace(/^return main\(\)$/m, 'main()');
    assert.doesNotThrow(() => new vm.Script(syntaxSafeText), `${path.basename(file)} 本地语法不通过`);
    assert.ok(!code.includes('=>'), `${path.basename(file)} 不许用箭头函数`);
    assert.ok(!code.includes('`'), `${path.basename(file)} 不许用模板字符串`);
  }
});

test('末行必须是顶层 return main()（只写 main() 时金山拿不到返回值）', () => {
  for (const file of listScripts()) {
    const lines = stripComments(readScript(file)).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    assert.equal(lines[lines.length - 1], 'return main()', `${path.basename(file)} 末行不对`);
  }
});

test('纯 ASCII（中文注释会被剪贴板/粘贴通道弄成乱码 → SyntaxError: Invalid or unexpected token）', () => {
  for (const file of listScripts()) {
    const bad = [...readScript(file)].filter((ch) => ch.charCodeAt(0) > 127);
    assert.deepEqual(bad.slice(0, 5), [], `${path.basename(file)} 含非 ASCII 字符`);
  }
});
