// 7号：云端写入脚本 读一行() 的拆层单测（离线，不触网、不碰真表）。
// 背景（2026-10-06 实测，第 1 次）：单行 Range 的 Value2 在金山是**二维数组**（形如 [[列A值, 列B值, …]]），
//   旧代码只把最外层当数组 → 整个行数组被 String() 成一串、截前 40 字
//   （实测 readBack 只有 ["A=46301,,2,18,…"]，S 列根本露不出来）。
// 这些断言**直接把云端脚本里的真身取出来跑**（new Function 加载 .md 全文，不是复制一份逻辑），
//   所以谁把 拆行数据() 删掉/改回内联一维处理，这里就红。
// 注意：本机 project-config/ 不入库（含真实文件名），文件不在时整组跳过；在则必须绿。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const 脚本路径 = path.join(__dirname, "..", "project-config", "kdocs-scripts", "AirScript-登记写入-独立脚本.md");
const 跳过原因 = fs.existsSync(脚本路径) ? false : "本机私有脚本不在（project-config 不入库），跳过";

// 把云端脚本文本包进一个函数体来加载：顶层 `return main()` 换成返回我们要测的两个纯函数。
function 载入云端函数() {
  const 文本 = fs.readFileSync(脚本路径, "utf8")
    .replace(/^return main\(\)\s*$/m, "return { 读一行: 读一行, 拆行数据: 拆行数据 }");
  return new Function("Application", "Context", 文本)({}, {});
}

function 造表(值) {
  return { Range: () => ({ Value2: 值 }) };
}

test("单行二维数组（金山真实形状）：拆层后 J/S 列都能看到（旧 bug 只剩 40 字一整串）", { skip: 跳过原因 }, () => {
  const { 读一行 } = 载入云端函数();
  const 行 = [];
  行[0] = "2026/10/06"; // A
  行[5] = "正常"; // F
  行[6] = "普票"; // G
  行[8] = "天猫1店"; // I
  行[9] = "5127686424005021034"; // J：19 位订单号必须完整可见
  行[14] = "AI助手"; // O
  行[18] = "同一个订单发票开一起"; // S：2026-10-06 实测就是它露不出来
  const 展示 = 读一行(造表([行]), 2777);
  assert.deepEqual(展示[0], "A=2026/10/06");
  assert.ok(展示.includes("J=5127686424005021034"), `J 列要露出来：${JSON.stringify(展示)}`);
  assert.ok(展示.includes("S=同一个订单发票开一起"), `S 列要露出来：${JSON.stringify(展示)}`);
  assert.ok(展示.length - 1 > 0, `不该只有一个被截断的 A=… 项（旧 bug 形状）：${JSON.stringify(展示)}`);
});

test("多行二维数组：只取第一行（第二行的值不许混进来）", { skip: 跳过原因 }, () => {
  const { 读一行 } = 载入云端函数();
  const 第一行 = ["甲", "", "", "", "", "正常"];
  const 第二行 = ["乙", "", "", "", "", "异常"];
  const 展示 = 读一行(造表([第一行, 第二行]), 5);
  assert.ok(展示.includes("A=甲"), `要第一行：${JSON.stringify(展示)}`);
  assert.ok(展示.includes("F=正常"), `要第一行的 F 列：${JSON.stringify(展示)}`);
  assert.ok(!展示.includes("A=乙"), `第二行混进来了：${JSON.stringify(展示)}`);
  assert.ok(!展示.includes("F=异常"), `第二行混进来了：${JSON.stringify(展示)}`);
});

test("一维数组 / 单格标量兜底：某些引擎不包二维时不炸、仍从 A 列展示", { skip: 跳过原因 }, () => {
  const { 读一行, 拆行数据 } = 载入云端函数();
  assert.deepEqual(拆行数据(["甲", "乙"]), ["甲", "乙"]);
  assert.deepEqual(拆行数据("甲"), ["甲"]);
  assert.deepEqual(拆行数据([["甲", "乙"], ["丙"]]), ["甲", "乙"]);
  assert.deepEqual(读一行(造表("甲"), 5), ["A=甲"]);
  assert.deepEqual(读一行(造表(null), 5), []);
});

test("反向断言：读一行 必须先过 拆行数据()（不许退回内联一维处理）", { skip: 跳过原因 }, () => {
  const 文本 = fs.readFileSync(脚本路径, "utf8");
  assert.ok(文本.includes("var 行数据 = 拆行数据(值)"), "读一行 没有调用拆行数据()");
  assert.ok(!文本.includes("var 行数据 = (值 instanceof Array) ? 值 : [值]"), "旧的一维处理又回来了（粘贴通道无需等号也允许的写法，但拆层必须走纯函数）");
});
