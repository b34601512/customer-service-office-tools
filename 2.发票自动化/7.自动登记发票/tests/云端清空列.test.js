// 7号：云端写入脚本 v2026-10-09.1 显式清空（clearCells）的离线单测（不触网、不碰真表）。
// 背景：个人票税号栏 AB 要留空 → 本地 `改登记行.js --清 AB` 发 clearCells；云端必须：
//   ① 认 规整清空列()（数组/字符串都行）；② 清空只走 ClearContents + 只认 可写列；
//   ③ 清掉的列同时进 writtenColumns（本地判据「目标列必须在 writtenColumns」才对得上）；
//   ④ writeCells 里的空值**仍旧跳过**（防打错成空值误清——清空必须显式声明）。
// 反向断言写成源码文本检查（与 tests/云端读一行.test.js 同风格）：谁把清空分支删了/改回写空值，这里就红。
// 注意：本机 project-config/ 不入库（含真实文件名），文件不在时整组跳过；在则必须绿。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const 脚本路径 = path.join(__dirname, "..", "project-config", "kdocs-scripts", "AirScript-登记写入-独立脚本.md");
const 跳过原因 = fs.existsSync(脚本路径) ? false : "本机私有脚本不在（project-config 不入库），跳过";

function 载入云端函数() {
  const 文本 = fs.readFileSync(脚本路径, "utf8")
    .replace(/^return main\(\)\s*$/m, "return { 规整清空列: 规整清空列 }");
  return new Function("Application", "Context", 文本)({}, {});
}

test("规整清空列：数组 / 字符串 / 逗号串 / 大小写 / 空值都规整对", { skip: 跳过原因 }, () => {
  const { 规整清空列 } = 载入云端函数();
  assert.deepEqual(规整清空列(["AB"]), ["AB"]);
  assert.deepEqual(规整清空列(["ab", "AA"]), ["AB", "AA"]);
  assert.deepEqual(规整清空列("AB,aa"), ["AB", "AA"]);
  assert.deepEqual(规整清空列(" AB "), ["AB"]);
  assert.deepEqual(规整清空列(""), []);
  assert.deepEqual(规整清空列(null), []);
  assert.deepEqual(规整清空列(undefined), []);
});

test("反向断言：writeCells 里的空值仍被跳过（清空必须走 clearCells，不许拿空值当清空）", { skip: 跳过原因 }, () => {
  const 文本 = fs.readFileSync(脚本路径, "utf8");
  assert.ok(文本.includes("if (值 === null || 值 === undefined || 值 === '') continue"), "writeCells 的空值跳过没了——空值可能被当成清空");
  assert.ok(文本.includes("clearCells"), "云端脚本没有 clearCells 入口");
  assert.ok(文本.includes("ClearContents()"), "清单元格没有走 ClearContents");
});

test("反向断言：清空列必须只认 可写列、且清完把列名报进 writtenColumns（本地闸门④要对得上）", { skip: 跳过原因 }, () => {
  const 文本 = fs.readFileSync(脚本路径, "utf8");
  assert.ok(文本.includes("清空清单.indexOf(清空列)"), "清空循环没对 可写列 名单做过滤");
  assert.ok(文本.includes("写入结果.push(清空列)"), "清掉的列没有进 writtenColumns（本地会判「缺目标列」）");
  assert.ok(文本.includes("clearedColumns: 清空结果"), "返回值缺 clearedColumns 证据字段");
});
