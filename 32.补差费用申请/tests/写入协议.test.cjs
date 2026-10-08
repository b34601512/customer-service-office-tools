#!/usr/bin/env node
// 32号 写入协议回归测试（2026-10-08.3）：
//   webhook 入站数组在 AirScript 里是**宿主对象**：能下标、有 length，但 `instanceof Array` 为 false
//   （2026-10-08 实测：v2 的「写汇总/写主体」守卫因此全部误判成“没有行”，一个字节没写）。
//   本测试把 AirScript 正文按 Node 函数加载，模拟两种入站形态：
//     ① 宿主数组（vm 跨 realm，instanceof 为 false）→ 转净数组 必须重建成原生数组；
//     ② JSON 字符串（客户端 v3 起这样传）→ 转净数组 必须解析出原生数组。
//   并验证：守卫放行、写块对「=DISPIMG(…)」公式格走 Formula 写入（收款码图片）、argv 形态兼容。
// 跑：node tests/写入协议.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const 项目根 = path.resolve(__dirname, "..");
const 脚本路径 = path.join(项目根, "kdocs-scripts", "AirScript-补差-写入.md");

let 通过 = 0;
let 失败 = 0;
function 断言(条件, 说明, 实测 = "") {
  if (条件) { 通过 += 1; console.log(`  ✓ ${说明}`); }
  else { 失败 += 1; console.log(`  ✗ ${说明}${实测 ? `｜实测：${实测}` : ""}`); }
}

// 把 AirScript 正文当 Node 函数加载（末尾 return main() 换成导出内部函数）
function 实例化(宿主对象 = {}) {
  let 源码 = fs.readFileSync(脚本路径, "utf8");
  const 尾 = 源码.lastIndexOf("return main()");
  if (尾 < 0) throw new Error("脚本末尾没有 return main()，加载失败");
  源码 = 源码.slice(0, 尾);
  const 工厂 = new Function(
    "Context", "Application",
    源码 + "\nreturn { scriptVersion, 是数组, 转净数组, 转对象, 入参形态, 执行写汇总, 执行写主体, 写块, 对比块, 解析参数 };"
  );
  return 工厂(宿主对象.Context, 宿主对象.Application);
}

// 假文档对象：任何表都取不到 → 守卫通过后会报“没有『表』”，据此判断守卫有没有放行
function 造空Application() {
  return {
    Worksheets: {
      Item() { throw new Error("stub：没有表"); },
      Count: 0
    }
  };
}

// 假表：记录 Value2 整块与 Formula 单格写入
function 造记录表() {
  const 记录 = { 值块: null, 公式: [] };
  const 表 = {
    Range() {
      return {
        set Value2(v) { 记录.值块 = v; },
        set NumberFormat(_f) {},
        get NumberFormat() { return ""; }
      };
    },
    Cells(r, c) {
      return { set Formula(f) { 记录.公式.push({ 行: r, 列: c, 公式: f }); } };
    }
  };
  return { 表, 记录 };
}

function 宿主数组(字面量) {
  return vm.runInNewContext(`(${字面量})`);
}

function 主() {
  const 脚本 = 实例化({ Application: 造空Application() });
  console.log(`\n  脚本版本：${脚本.scriptVersion}`);
  断言(脚本.scriptVersion === "2026-10-08.3", "脚本是 v3（2026-10-08.3）", 脚本.scriptVersion);

  // ── 1) 平台形态：宿主数组 instanceof 为 false（转净数组 存在的理由）───────────────
  const 宿主 = 宿主数组('[["甲","=DISPIMG(\\"ID_1\\",1)"],["乙","x"]]');
  const 原生 = [["甲", '=DISPIMG("ID_1",1)'], ["乙", "x"]];
  断言(!(宿主 instanceof Array), "vm 宿主数组 instanceof Array 为 false（模拟平台入站形态）");
  断言(Array.isArray(宿主), "vm 宿主数组 Array.isArray 为 true（能下标/有 length）");

  // ── 2) 是数组 / 转净数组 ─────────────────────────────────────────────────────
  断言(脚本.是数组(宿主), "是数组(宿主数组) = true");
  断言(!脚本.是数组("[1,2]"), "是数组(字符串) = false");
  断言(!脚本.是数组({ a: 1 }), "是数组(普通对象) = false");
  const 净1 = 脚本.转净数组(宿主);
  断言(净1 instanceof Array && 净1.every((r) => r instanceof Array), "转净数组(宿主数组) → 全原生数组");
  断言(JSON.stringify(净1) === JSON.stringify(原生), "转净数组(宿主数组) 内容一致");
  const 净2 = 脚本.转净数组(JSON.stringify(原生));
  断言(净2 instanceof Array && 净2.every((r) => r instanceof Array), "转净数组(JSON字符串) → 全原生数组");
  断言(JSON.stringify(净2) === JSON.stringify(原生), "转净数组(JSON字符串) 内容一致");
  const 净3 = 脚本.转净数组(原生);
  断言(JSON.stringify(净3) === JSON.stringify(原生), "转净数组(原生数组) 原样可用");
  断言(脚本.转净数组({ a: 1 }).length === 0, "转净数组(普通对象) → []（按缺行处理）");
  断言(脚本.转净数组("不是JSON").length === 0, "转净数组(坏字符串) → []（不抛错）");

  // ── 3) 守卫放行（v2 在宿主数组/字符串上都会误判）──────────────────────────────
  const 汇宿主 = 脚本.执行写汇总({ 汇总行: 宿主 });
  断言(汇宿主.message !== "没有汇总行", "写汇总(宿主数组) 守卫放行（不再误判）", JSON.stringify(汇宿主).slice(0, 160));
  断言(String(汇宿主.message).includes("没有『汇总』表"), "写汇总(宿主数组) 走到取表这步");
  const 汇串 = 脚本.执行写汇总({ 汇总行: JSON.stringify(原生) });
  断言(汇串.message !== "没有汇总行", "写汇总(JSON字符串) 守卫放行", JSON.stringify(汇串).slice(0, 160));
  const 汇空 = 脚本.执行写汇总({ 汇总行: [] });
  断言(汇空.message === "没有汇总行" && 汇空.入参形态 && 汇空.入参形态.长度 === "0", "写汇总(空数组) 仍拦住 + 回传入参形态");

  const 主宿主 = 脚本.执行写主体({ 集团行: 宿主, 器械行: 宿主, 预期: { 集团: 19, 器械: 12 } });
  断言(主宿主.集团 && 主宿主.集团.message !== "缺 集团行/器械行", "写主体(宿主数组) 守卫放行（集团）", JSON.stringify(主宿主).slice(0, 200));
  断言(主宿主.器械 && 主宿主.器械.message !== "缺 集团行/器械行", "写主体(宿主数组) 守卫放行（器械）");
  const 主串 = 脚本.执行写主体({ 集团行: JSON.stringify(原生), 器械行: JSON.stringify(原生), 预期: { 集团: 19, 器械: 12 } });
  断言(主串.集团 && 主串.集团.message !== "缺 集团行/器械行", "写主体(JSON字符串) 守卫放行");
  const 主缺 = 脚本.执行写主体({ 集团行: [], 器械行: JSON.stringify(原生), 预期: {} });
  断言(主缺.message === "缺 集团行/器械行", "写主体(缺集团行) 仍拦住 + 回传入参形态");

  // ── 4) 写块：收款码「=DISPIMG(…)」必须走 Formula（v2 在宿主数组上会漏掉）────────
  {
    const { 表, 记录 } = 造记录表();
    脚本.写块(表, 1, 宿主, 2);
    断言(记录.公式.length === 0, "对照：宿主数组直写 → 公式格漏掉（复现 v2 缺陷）", JSON.stringify(记录.公式));
  }
  {
    const { 表, 记录 } = 造记录表();
    const 净行 = 脚本.转净数组(宿主);
    脚本.写块(表, 1, 净行, 2);
    断言(记录.值块 instanceof Array && 记录.值块[0] instanceof Array, "写块：Value2 收到原生二维数组");
    断言(记录.公式.length === 1 && 记录.公式[0].行 === 1 && 记录.公式[0].列 === 2 && 记录.公式[0].公式 === '=DISPIMG("ID_1",1)', "写块：DISPIMG 公式格走 Formula 写入", JSON.stringify(记录.公式));
  }

  // ── 5) 对比块：宿主数组当期望也能逐格比（下标访问正常）─────────────────────────
  {
    const 差异 = 脚本.对比块(宿主, 原生, 2);
    断言(差异.length === 0, "对比块(宿主期望 vs 原生实际) 0 差异", JSON.stringify(差异));
  }

  // ── 6) argv 形态兼容（22号 实测：字符串/数组/类数组对象都可能）──────────────────
  {
    const 种 = [
      ["对象", { action: "探针" }],
      ["JSON字符串", '{"action":"探针"}'],
      ["真数组", [{ action: "探针" }]],
      ["宿主数组", 宿主数组('[{ "action": "探针" }]')],
      ["类数组对象", { 0: { action: "探针" } }]
    ];
    for (const [名, 值] of 种) {
      const s = 实例化({ Context: { argv: 值 }, Application: 造空Application() });
      const 参 = s.解析参数();
      断言(参 && 参.action === "探针", `解析参数(${名}) → action 正确`, JSON.stringify(参));
    }
  }

  console.log(`\n  结果：${通过} 通过 / ${失败} 失败\n`);
  process.exitCode = 失败 ? 1 : 0;
}

主();
