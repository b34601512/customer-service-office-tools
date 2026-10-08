#!/usr/bin/env node
// 32号 主体表收款码图 回归测试（2026-10-08）：
//   ① 映射：批次 主体行（第 4 行起）↔ 汇总行，按**订单编号**对齐（不靠顺序/偏移），只收 B 是 DISPIMG 的行；
//   ② 守卫：错表（汇总）/错列（C）/越界行（<4、>末行）/非 DISPIMG 格/占位图/超体积/超条数 → 一律拒绝；
//   ③ payload 形状：条目只有 表/行/图片（只 B 列，不带列号）、allowWrite:true、带预期末行；
//   ④ 反向断言：服务端只回 status:'已写入'（没有 written:true + writtenColumns 含 B）→ 必判失败；
//   ⑤ 失败停手：回执不合格或抛错 → 不再发后续批、不重试，证据带错误原文；
//   ⑥ 写图引用：从汇总回读 matrix 取现役 DISPIMG ID 写成引用项；非 DISPIMG 的格拒绝。
// 跑：node tests/主体收款图.test.cjs
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..");
const {
  解析参数, 选表键, 筛行, 图项索引, 图片合格,
  从批次建映射, 从映射建映射, 附图片, 校验插图项, 校验引用项, 校体积,
  构造插图请求, 构造引用请求, 构造引用项, 服务端写入成功, 执行写序列
} = require(path.join(项目根, "scripts", "主体收款图.cjs"));

let 通过 = 0;
let 失败 = 0;
function 断言(条件, 说明, 实测 = "") {
  if (条件) { 通过 += 1; console.log(`  ✓ ${说明}`); }
  else { 失败 += 1; console.log(`  ✗ ${说明}${实测 ? `｜实测：${实测}` : ""}`); }
}
function 新证据目录() { return fs.mkdtempSync(path.join(os.tmpdir(), "32-主体收款图-")); }
function 好图(字节 = 20000) {
  return { dataURL: "data:image/jpeg;base64," + "A".repeat(Math.ceil((字节 * 4) / 3)), 字节, 宽: 320, 高: 436, 文件: "样.jpg" };
}
function 占位图() {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg";
  return { dataURL: "data:image/png;base64," + b64, 宽: 1, 高: 1 };
}

// 迷你批次：明细顺序故意与主体行不同 → 证明按订单编号对齐，不是按序号硬对
function 造批次() {
  const 明细 = [
    { 源行号: 453, 汇总行: 行18("姓黄", "13800000000", "O7") },
    { 源行号: 451, 汇总行: 行18("程小霞", '=DISPIMG("ID_S1",1)', "O5") },
    { 源行号: 452, 汇总行: 行18("单佳", '=DISPIMG("ID_S2",1)', "O6") },
    { 源行号: 459, 汇总行: 行18("林长利", "sstatjhking@126.com", "O9") }
  ];
  const 集团行 = [
    行12("王家涛", "6230880020019354729", "O4"),
    行12("程小霞", '=DISPIMG("ID_S1",1)', "O5"),
    行12("单佳", '=DISPIMG("ID_S2",1)', "O6"),
    行12("姓黄", "13800000000", "O7")
  ];
  const 器械行 = [行12("冯彩茹", "15138007261", "O8")];
  return {
    月份: "2026-09",
    行数: 明细.length,
    明细,
    预期末行: { 汇总: 1672, 集团: 19, 器械: 12 },
    主体: {
      "深圳市德达医疗科技集团有限公司": { 行: 集团行 },
      "深圳市德达医疗器械有限公司": { 行: 器械行 }
    }
  };
}
function 行18(姓名, 账号, 订单) {
  const r = new Array(18).fill("");
  r[1] = 姓名; r[2] = 账号; r[4] = 订单;
  return r;
}
function 行12(姓名, B, 订单) {
  const r = new Array(12).fill("");
  r[0] = 姓名; r[1] = B; r[3] = 订单;
  return r;
}

// 假服务端：按请求里的条目逐行回报；可让某一格跳过、只回「已写入」、或整个调用抛错
function 造假服务端(选项 = {}) {
  const 调用 = [];
  const 调 = async (请求) => {
    调用.push(请求);
    if (选项.抛错) throw new Error(String(选项.抛错));
    const 列表 = JSON.parse(请求.action === "插图" ? 请求.图 : 请求.引用);
    if (选项.只回已写入) return { scriptVersion: "x", 模式: 请求.action, status: "已写入", 成功数: 列表.length };
    const 逐行 = [], 跳过 = [];
    for (const x of 列表) {
      if (选项.跳过键 === `${x.表}${x.行}` || 选项.跳过键 === `${x.表}:${x.行}`) {
        跳过.push({ 表: x.表, 行: x.行, 跳过原因: "假服务端：该格当前不是 DISPIMG 公式" });
        continue;
      }
      逐行.push({
        表: x.表, 行: x.行,
        插入: 请求.action === "插图" ? "成功" : "",
        写入: 请求.action === "写图引用" ? "成功" : "",
        旧公式: '=DISPIMG("ID_旧",1)',
        新公式: 请求.action === "写图引用" ? `=DISPIMG("${x.图片ID}",1)` : '=DISPIMG("ID_新",1)'
      });
    }
    return {
      scriptVersion: "2026-10-08.1", 模式: 请求.action,
      written: 逐行.length > 0, writtenColumns: ["B"],
      请求数: 列表.length, 成功数: 逐行.length, 失败数: 0, 回读不符数: 0,
      逐行, 跳过
    };
  };
  return { 调, 调用 };
}

async function 主() {
  console.log("\n32号 主体表收款码图 回归测试\n");

  // ── 1) 批次 → 映射（按订单编号对齐；非 DISPIMG 行跳过）──────────────────────
  {
    const r = 从批次建映射(造批次(), ["集团", "器械"]);
    断言(r.项.length === 2, "4+1 行里只挑出 2 个 DISPIMG 行", JSON.stringify(r.项.map((x) => [x.表, x.行, x.汇总行])));
    断言(r.项[0].行 === 5 && r.项[0].汇总行 === 1674 && r.项[0].源ID === "ID_S1", "程小霞：集团行 5 → 汇总行 1674（按订单编号，不靠明细顺序）", JSON.stringify(r.项[0]));
    断言(r.项[1].行 === 6 && r.项[1].汇总行 === 1675 && r.项[1].源ID === "ID_S2", "单佳：集团行 6 → 汇总行 1675", JSON.stringify(r.项[1]));
    断言(r.跳过.some((x) => x.行 === 4 && /不是 DISPIMG/.test(x.说明)), "王家涛（银行卡）进跳过，不写");
    断言(r.跳过.some((x) => x.行 === 7), "姓黄（手机号）进跳过，不写");
    断言(r.末行表.集团 === 7 && r.末行表.器械 === 4, "数据末行：集团 7 / 器械 4（4+行数-1）", JSON.stringify(r.末行表));
  }

  // ── 2) 只读映射文件（对照）────────────────────────────────────────────────────
  {
    const 映射 = {
      口径: { 集团数据止行: 13 },
      对照: [
        { 集团行: 5, 姓名: "程小霞", 订单编号: "342676431360", 集团B_ID: "ID_A", 汇总行: 1674 },
        { 集团行: 8, 姓名: "顾雁婷", 订单编号: "5127403394295018842", 集团B_ID: "ID_B", 汇总行: 1677 }
      ]
    };
    const r = 从映射建映射(映射, ["集团"]);
    断言(r.项.length === 2 && r.项[1].行 === 8 && r.项[1].汇总行 === 1677, "映射对照 → 集团行/汇总行原样带出", JSON.stringify(r.项));
    断言(r.末行表.集团 === 13, "数据末行取 口径.集团数据止行 = 13", String(r.末行表.集团));
  }

  // ── 3) 图目录附加 + 图片合格（占位图要拦）────────────────────────────────────
  {
    const 图索引 = 图项索引([{ 行: 1674, 目标行: 1674, ...好图() }, { 行: 1675, 汇总行: 1675, ...好图() }]);
    const r = 从批次建映射(造批次(), ["集团"]);
    const 附 = 附图片(r.项, 图索引);
    断言(附.项.length === 2 && 附.拒绝.length === 0, "按汇总行取到 2 张图", JSON.stringify(附.拒绝));
    断言(附.项[0].文件名 === undefined && 附.项[0].文件 === "样.jpg", "附件信息带出（文件）", String(附.项[0].文件));
    断言(附.项[0].字节 === 20000, "字节 20000 带出");
    断言(图片合格(好图()).合格 === true, "正常图（20KB/320x436）合格");
    断言(图片合格(占位图()).合格 === false && /占位|1KB/.test(图片合格(占位图()).原因), "1x1 占位图 → 拒（疑占位）", 图片合格(占位图()).原因);
    断言(图片合格({ dataURL: "https://x.com/a.png" }).合格 === false, "非 data:image/ → 拒");
    断言(图片合格({ dataURL: "data:image/jpeg;base64,AAAA", 宽: 320, 高: 436 }).合格 === false, "字节算出来 <1KB → 拒（不认「字节」空写）");
    const 缺图 = 附图片([{ 表: "集团", 行: 5, 汇总行: 9999 }], 图索引);
    断言(缺图.项.length === 0 && /没有汇总行 9999/.test(缺图.拒绝[0].原因), "图目录里没有该汇总行 → 拒", 缺图.拒绝[0].原因);
  }

  // ── 4) 客户端守卫：错表 / 错列 / 越界行 / 非 DISPIMG / 坏图 ─────────────────
  {
    const 末行表 = { 集团: 7 };
    const 好项 = { 表: "集团", 行: 5, 汇总行: 1674, 姓名: "程小霞", ...好图() };
    const r = 校验插图项([
      好项,
      { ...好项, 表: "汇总", 行: 1674, 汇总行: 1674 },
      { ...好项, 行: 3 },
      { ...好项, 行: 8 },
      { ...好项, 列: "C" },
      { ...好项, 行: 6, 字节: 0, dataURL: "data:image/jpeg;base64,AAAAA" }
    ], 末行表);
    断言(r.项.length === 1 && r.项[0].行 === 5, "只有 1 条合格，其余 5 条全拒", JSON.stringify({ 周: r.项.length, 拒: r.拒绝.length }));
    断言(r.拒绝.some((x) => x.表 === "汇总" && /白名单/.test(x.原因)), "表=汇总 → 拒（白名单）");
    断言(r.拒绝.some((x) => x.行 === 3 && /≥4/.test(x.原因)), "行 3（头部）→ 拒");
    断言(r.拒绝.some((x) => x.行 === 8 && /超出.*末行 7/.test(x.原因)), "行 8（超末行）→ 拒");
    断言(r.拒绝.some((x) => /列 C/.test(x.原因)), "列 C → 拒（只 B 列）");
    断言(r.拒绝.some((x) => /占位|1KB/.test(x.原因)), "坏图（<1KB）→ 拒");
    const 非图行 = 从批次建映射(造批次(), ["集团"]);
    断言(非图行.跳过.some((x) => x.行 === 4) && !非图行.项.some((x) => x.行 === 4), "非 DISPIMG 格（账号）绝不进待写");
  }

  // ── 5) 体积/条数守门 ─────────────────────────────────────────────────────────
  {
    const 单超 = 校体积([{ 行: 5, ...好图(61 * 1024) }]);
    断言(!单超.通过 && 单超.失败.some((f) => /单张/.test(f.原因)), "单张 61KB → 拒", JSON.stringify(单超.失败));
    const 整超 = 校体积([1, 2, 3, 4, 5].map((i) => ({ 行: i + 4, 字节: 220 * 1024, dataURL: "data:image/jpeg;base64," + "A".repeat(300000) })));
    断言(!整超.通过 && 整超.失败.some((f) => /整批/.test(f.原因)), "5 张合计 1.1MB → 拒", JSON.stringify(整超.失败.map((f) => f.原因)));
    const 超条 = 校体积(Array.from({ length: 21 }, (_, i) => ({ 行: 4 + i, 字节: 2000, dataURL: "data:image/jpeg;base64,AAAA" })));
    断言(!超条.通过 && 超条.失败.some((f) => /21 条/.test(f.原因)), "21 条/批 → 拒（≤20 条）", JSON.stringify(超条.失败.map((f) => f.原因)));
    const 正好 = 校体积(Array.from({ length: 7 }, (_, i) => ({ 行: 4 + i, ...好图(19000) })));
    断言(正好.通过, "7 张 ×19KB（≈133KB）→ 通过", JSON.stringify({ 总: 正好.总字节 }));
  }

  // ── 6) payload 形状：只有 表/行/图片，只 B 列 ─────────────────────────────────
  {
    const 项 = [
      { 表: "集团", 行: 5, 图片: 好图().dataURL, 字节: 20000 },
      { 表: "集团", 行: 6, 图片: 好图().dataURL, 字节: 20000 }
    ];
    const 请求 = 构造插图请求(项, { 集团: 7 });
    断言(请求.action === "插图" && 请求.allowWrite === true, "action=插图 / allowWrite:true");
    断言(JSON.stringify(请求.预期) === '{"集团":7}', "带预期末行 {集团:7}", JSON.stringify(请求.预期));
    const 条目 = JSON.parse(请求.图);
    断言(JSON.stringify(Object.keys(条目[0])) === '["表","行","图片"]', "条目字段只有 表/行/图片（不带列号）", JSON.stringify(Object.keys(条目[0])));
    断言(条目[0].表 === "集团" && 条目[0].行 === 5 && 条目[0].图片.slice(0, 11) === "data:image/", "条目内容正确");
    const 引用请求 = 构造引用请求([{ 表: "集团", 行: 5, 图片ID: "ID_ABC" }], { 集团: 7 });
    断言(引用请求.action === "写图引用" && JSON.stringify(Object.keys(JSON.parse(引用请求.引用)[0])) === '["表","行","图片ID"]', "写图引用条目字段 = 表/行/图片ID", JSON.stringify(Object.keys(JSON.parse(引用请求.引用)[0])));
  }

  // ── 7) 反向断言：只回「已写入」/缺 writtenColumns 一律不认 ───────────────────
  {
    断言(服务端写入成功(null) === false && 服务端写入成功(undefined) === false, "空回执 → false");
    断言(服务端写入成功({ status: "已写入", 成功数: 7 }) === false, "只回 status:'已写入'（无 written:true）→ false");
    断言(服务端写入成功({ written: true }) === false, "written:true 但没有 writtenColumns → false");
    断言(服务端写入成功({ written: true, writtenColumns: ["C"] }) === false, "writtenColumns 不含 B → false");
    断言(服务端写入成功({ written: false, writtenColumns: ["B"] }) === false, "written:false → false");
    断言(服务端写入成功({ written: true, writtenColumns: ["B"] }) === true, "written:true + ['B'] → true");
  }

  // ── 8) 执行写序列：成功、证据落盘、整批一把 ─────────────────────────────────
  {
    const 证据 = 新证据目录();
    const 项 = [
      { 表: "集团", 行: 5, 图片: 好图().dataURL, 字节: 20000, 汇总行: 1674, 姓名: "程小霞" },
      { 表: "集团", 行: 6, 图片: 好图().dataURL, 字节: 20000, 汇总行: 1675, 姓名: "单佳" },
      { 表: "集团", 行: 7, 图片: 好图().dataURL, 字节: 20000, 汇总行: 1676, 姓名: "姓黄" }
    ];
    const { 调, 调用 } = 造假服务端();
    const 果 = await 执行写序列({ 项, 每批: 0, 预期: { 集团: 7 }, 动作: "插图", 证据名: "插图", 证据目录: 证据, 调脚本: 调 });
    断言(调用.length === 1 && 调用[0].allowWrite === true, "3 格一把请求（1 次）", String(调用.length));
    断言(果.成功 === 3 && 果.全合格 === true && 果.停手 === "", "3/3 全合格", JSON.stringify({ 成: 果.成功, 全: 果.全合格 }));
    断言(果.行结果.every((x) => x.合格 && x.插入 === "成功"), "行结果：每行插入成功", JSON.stringify(果.行结果));
    断言(fs.existsSync(path.join(证据, "插图-1.json")), "证据 插图-1.json 已落盘");
  }

  // ── 9) 失败停手：只回「已写入」→ 反向断言判失败、不再发第 2 批 ──────────────
  {
    const 证据 = 新证据目录();
    const 项 = [5, 6, 7, 8].map((行) => ({ 表: "集团", 行, 图片: 好图().dataURL, 字节: 20000 }));
    const { 调, 调用 } = 造假服务端({ 只回已写入: true });
    const 果 = await 执行写序列({ 项, 每批: 2, 预期: { 集团: 8 }, 动作: "插图", 证据名: "插图", 证据目录: 证据, 调脚本: 调 });
    断言(调用.length === 1, "第 1 批被反向断言拦下 → 不再发第 2 批", String(调用.length));
    断言(果.成功 === 0 && 果.全合格 === false && /反向断言/.test(果.停手), "0/4、停手原文带「反向断言」", String(果.停手).slice(0, 80));
    断言(果.行结果.length === 4 && 果.行结果.every((x) => !x.合格), "4 行全部记不合格");
  }

  // ── 10) 失败停手：抛错（限流/5xx）→ 证据带原文、不重试 ──────────────────────
  {
    const 证据 = 新证据目录();
    const 项 = [5, 6, 7].map((行) => ({ 表: "集团", 行, 图片: 好图().dataURL, 字节: 20000 }));
    const { 调, 调用 } = 造假服务端({ 抛错: "金山接口返回 HTTP 403：ScriptRetryLater" });
    const 果 = await 执行写序列({ 项, 每批: 2, 预期: { 集团: 7 }, 动作: "插图", 证据名: "插图", 证据目录: 证据, 调脚本: 调 });
    断言(调用.length === 1, "抛错后不再请求（也不重试）", String(调用.length));
    断言(果.成功 === 0 && !果.全合格 && /403/.test(果.停手), "0/3，停手带 403 原文");
    断言(JSON.stringify(果.行结果).includes("上一批失败后停手") || 果.行结果.filter((x) => !x.合格).length === 3, "未发起的行也记不合格", JSON.stringify(果.行结果.map((x) => (x.错误 || "").slice(0, 24))));
    const 证据体 = JSON.parse(fs.readFileSync(path.join(证据, "插图-1.json"), "utf8"));
    断言(/403/.test(String(证据体.错误)), "证据文件带 403 错误原文", String(证据体.错误).slice(0, 60));
    断言(!fs.existsSync(path.join(证据, "插图-2.json")), "失败后不产生第 2 批证据");
  }

  // ── 11) 服务端跳过某格 → 该行不合格、整体不全合格 ───────────────────────────
  {
    const 证据 = 新证据目录();
    const 项 = [5, 6].map((行) => ({ 表: "集团", 行, 图片: 好图().dataURL, 字节: 20000 }));
    const { 调 } = 造假服务端({ 跳过键: "集团6" });
    const 果 = await 执行写序列({ 项, 每批: 0, 预期: { 集团: 6 }, 动作: "插图", 证据名: "插图", 证据目录: 证据, 调脚本: 调 });
    断言(果.成功 === 1 && 果.全合格 === false, "1/2（集团6 被服务端跳过）", JSON.stringify({ 成: 果.成功, 全: 果.全合格 }));
    断言(果.行结果.find((x) => x.行 === 6).跳过原因.includes("不是 DISPIMG"), "跳过行带服务端原文", JSON.stringify(果.行结果.find((x) => x.行 === 6)));
  }

  // ── 12) 写图引用：汇总回读 matrix → 现役 ID；非 DISPIMG 拒 ─────────────────
  {
    const 映射项 = [
      { 表: "集团", 行: 5, 汇总行: 1674, 姓名: "程小霞" },
      { 表: "集团", 行: 6, 汇总行: 1675, 姓名: "单佳" },
      { 表: "集团", 行: 7, 汇总行: 9999, 姓名: "没有的行" }
    ];
    const 矩阵 = new Array(1676).fill(null).map(() => new Array(18).fill(""));
    矩阵[1674 - 1][2] = '=DISPIMG("ID_新A",1)';
    矩阵[1675 - 1][2] = "普通文本（没图）";
    const r = 构造引用项(映射项, 矩阵);
    断言(r.项.length === 1 && r.项[0].图片ID === "ID_新A", "从 matrix 取到现役 ID_新A", JSON.stringify(r.项));
    断言(r.拒绝.length === 2, "非 DISPIMG / 矩阵没有的行 → 拒", JSON.stringify(r.拒绝.map((x) => x.原因)));
    const 校 = 校验引用项([
      { 表: "集团", 行: 5, 图片ID: "ID_新A" },
      { 表: "汇总", 行: 5, 图片ID: "ID_新A" },
      { 表: "集团", 行: 5, 图片ID: "X_坏" }
    ], { 集团: 7 });
    断言(校.项.length === 1 && 校.拒绝.length === 2, "引用项守卫：白名单 + ID_ 前缀", JSON.stringify(校.拒绝.map((x) => x.原因)));
    const 证据 = 新证据目录();
    const { 调, 调用 } = 造假服务端();
    const 果 = await 执行写序列({ 项: 校.项, 每批: 0, 预期: { 集团: 7 }, 动作: "写图引用", 证据名: "写图引用", 证据目录: 证据, 调脚本: 调 });
    断言(调用[0].action === "写图引用" && 果.全合格 === true, "写图引用走通（回执写入成功）", JSON.stringify({ 成: 果.成功 }));
  }

  // ── 13) 参数解析 ─────────────────────────────────────────────────────────────
  {
    const p = 解析参数(["--模式", "插图", "--批次", "runtime/待写数据/2026-09.json", "--图目录", "runtime/收款码图/2026-10-08-缩略图", "--表", "集团", "--行", "5", "--每批", "3", "--预演"]);
    断言(p.模式 === "插图" && p.批次.endsWith("2026-09.json") && p.图目录.endsWith("2026-10-08-缩略图") && p.表 === "集团" && p.行 === "5" && p.每批 === 3 && p.预演 === true, "参数解析全字段", JSON.stringify(p));
    断言(JSON.stringify(选表键("全部")) === '["集团","器械"]' && 选表键("器械")[0] === "器械", "选表键：全部/器械");
    断言(筛行([{ 行: 5 }, { 行: 6 }, { 行: 12 }], "5,12").map((x) => x.行).join() === "5,12", "筛行 --行 5,12 → 只留 5/12");
    断言(筛行([{ 行: 5 }], "").length === 1, "筛行 未给 → 全都要");
    let 错行 = ""; try { 筛行([{ 行: 5 }], "abc"); } catch (e) { 错行 = e.message; }
    断言(/没解析出有效行号/.test(错行), "筛行 坏行号 → 抛错（不默默全写）", 错行);
    let 错 = ""; try { 选表键("汇总"); } catch (e) { 错 = e.message; }
    断言(/只认 集团\/器械\/全部/.test(错), "选表键：汇总 → 抛错（白名单）", 错);
    let 错2 = ""; try { 校验插图项([{ 表: "汇总", 行: 5, ...好图() }], { 汇总: 999 }); } catch (e) { 错2 = e.message; }
    断言(错2 === "", "校验不抛错，走拒绝列表（汇总在拒绝里）");
  }

  // ── 14) 在线脚本本地 mock 运行（真读真判：白名单/行域/非 DISPIMG/预期/只 B 列/回读）──
  {
    const 服务端代码 = fs.readFileSync(path.join(项目根, "kdocs-scripts", "AirScript-补差-主体收款图.md"), "utf8");
    const 跑服务端 = (argv, 应用) => new Function("Application", "Context", 服务端代码)(应用, { argv });
    const 集团名 = "深圳市德达医疗科技集团有限公司";
    const 器械名 = "深圳市德达医疗器械有限公司";
    const 图 = "data:image/jpeg;base64," + "A".repeat(2000);

    // 假工作表：单元 Map + Range/Cells（含 InsertImage 后自动写回新 DISPIMG 公式）
    function 列号(名) { return 名.charCodeAt(0) - 64; }
    function 造假表(表名, 行数据, 选项 = {}) {
      const 单元 = new Map();
      for (const [行号, 行] of Object.entries(行数据 || {})) {
        const r = Number(行号);
        if (行.A !== undefined) 单元.set(`${r}:1`, { v: String(行.A) });
        if (行.B !== undefined) {
          const b = String(行.B);
          if (b.slice(0, 1) === "=") 单元.set(`${r}:2`, { f: b });
          else 单元.set(`${r}:2`, { v: b });
        }
      }
      单元.set("3:2", { v: 选项.表头 === undefined ? "收款方式" : 选项.表头 });
      if (选项.透视锚) 单元.set(`${选项.透视锚}:1`, { v: "求和项:金额" });
      const 取格 = (r, c) => 单元.get(`${r}:${c}`) || null;
      const 设公式 = (r, c, f) => { const x = 取格(r, c); if (x) { delete x.v; x.f = f; } else 单元.set(`${r}:${c}`, { f }); };
      const 区域 = (地址) => {
        const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(地址);
        const c1 = 列号(m[1]), r1 = Number(m[2]), c2 = m[3] ? 列号(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
        return {
          get Value2() {
            const 出 = [];
            for (let r = r1; r <= r2; r += 1) { const 行 = []; for (let c = c1; c <= c2; c += 1) { const x = 取格(r, c); 行.push(x ? (x.f !== undefined ? x.f : x.v) : ""); } 出.push(行); }
            return 出.length === 1 ? 出[0] : 出;
          },
          get Formula() { const x = 取格(r1, c1); if (!x) return ""; return x.f !== undefined ? x.f : x.v; },
          set Formula(值) { 设公式(r1, c1, String(值)); },
          InsertImage(dataURL) { if (选项.插入抛错) throw new Error(选项.插入抛错); 设公式(r1, c1, `=DISPIMG("ID_NEW_${r1}",1)`); }
        };
      };
      return {
        表名, 单元,
        Cells: (r, c) => ({
          get Value2() { const x = 取格(r, c); return x ? (x.f !== undefined ? x.f : x.v) : ""; },
          get Formula() { const x = 取格(r, c); if (!x) return ""; return x.f !== undefined ? x.f : x.v; },
          set Formula(值) { 设公式(r, c, String(值)); }
        }),
        Range: (地址) => 区域(地址)
      };
    }
    const 造应用 = (张们) => ({ Worksheets: { get Count() { return 张们.length; }, Item: (k) => (typeof k === "number" ? 张们[k - 1] : 张们.find((s) => s.表名 === k)) || null } });
    function 造集团(选项 = {}) {
      return 造假表(集团名, {
        4: { A: "王家涛", B: "6230880020019354729" },
        5: { A: "程小霞", B: '=DISPIMG("ID_S1",1)' },
        6: { A: "单佳", B: '=DISPIMG("ID_S2",1)' },
        7: { A: "姓黄", B: "13800000000" }
      }, { 透视锚: 20, ...选项 });
    }

    // 14.1 探针：末行/图行/无图行
    {
      const 集 = 造集团();
      const 械 = 造假表(器械名, { 4: { A: "冯彩茹", B: "15138007261" } }, { 透视锚: 15 });
      const 汇 = 造假表("汇总", { 1673: { A: "x", B: '=DISPIMG("ID_HUI",1)' } });
      const 报 = 跑服务端({ action: "探针" }, 造应用([汇, 集, 械]));
      断言(报.集团.数据末行 === 7 && 报.器械.数据末行 === 4, "探针：集团末行 7 / 器械末行 4", JSON.stringify([报.集团.数据末行, 报.器械.数据末行]));
      断言(报.集团.图行.map((x) => x.行).join(",") === "5,6" && 报.集团.图行数 === 2, "探针：集团图行 = 5,6", JSON.stringify(报.集团.图行));
      断言(报.集团.无图行.length === 2 && 报.集团.无图行[0].行 === 4, "探针：王家涛/姓黄进无图行", JSON.stringify(报.集团.无图行));
      断言(报.集团.B列表头 === "收款方式" && 报.scriptVersion === "2026-10-08.1", "探针：表头 + 版本", 报.scriptVersion);
    }

    // 14.2 插图：只写 B、回读、written/writtenColumns
    {
      const 集 = 造集团(); const 械 = 造假表(器械名, {}, {}); const 汇 = 造假表("汇总", {});
      const 报 = 跑服务端({ action: "插图", allowWrite: true, 预期: { 集团: 7 }, 图: JSON.stringify([{ 表: "集团", 行: 5, 图片: 图 }, { 表: "集团", 行: 6, 图片: 图 }]) }, 造应用([汇, 集, 械]));
      断言(报.written === true && 报.writtenColumns.join() === "B" && 报.成功数 === 2, "插图：written:true / writtenColumns [B] / 成功 2", JSON.stringify({ w: 报.written, c: 报.writtenColumns, n: 报.成功数 }));
      断言(报.readBack.length === 2 && String(集.单元.get("5:2").f).indexOf("ID_NEW_5") > 0, "插图：回读新图 ID（B5 → ID_NEW_5）", JSON.stringify(报.readBack));
      断言(集.单元.get("1:2") === undefined && 汇.单元.size === 1, "插图：没碰第 1 行/汇总表", "");
    }

    // 14.3 守卫：错表（汇总）/越界行/非 DISPIMG 格/预期不符 → 拒，汇总格不动
    {
      const 集 = 造集团(); const 汇 = 造假表("汇总", { 1674: { B: '=DISPIMG("ID_HUI",1)' } });
      const 应用 = 造应用([汇, 集, 造假表(器械名, {})]);
      const 报错表 = 跑服务端({ action: "插图", allowWrite: true, 图: JSON.stringify([{ 表: "汇总", 行: 1674, 图片: 图 }]) }, 应用);
      断言(报错表.written === false && /只认 集团\/器械/.test(报错表.跳过[0].跳过原因), "表=汇总 → 跳过（白名单）", JSON.stringify(报错表.跳过));
      断言(汇.单元.get("1674:2").f === '=DISPIMG("ID_HUI",1)', "汇总表 B 格一个字节没动", JSON.stringify(汇.单元.get("1674:2")));
      const 报行 = 跑服务端({ action: "插图", allowWrite: true, 图: JSON.stringify([{ 表: "集团", 行: 3, 图片: 图 }, { 表: "集团", 行: 8, 图片: 图 }, { 表: "集团", 行: 4, 图片: 图 }]) }, 应用);
      断言(报行.written === false && 报行.跳过.length === 3, "行 3/行 8/非 DISPIMG 行 4 → 全跳过", JSON.stringify(报行.跳过.map((x) => x.跳过原因)));
      断言(/不在数据区/.test(报行.跳过[1].跳过原因) && /不是 DISPIMG/.test(报行.跳过[2].跳过原因), "跳过原因：越界 / 非 DISPIMG", JSON.stringify(报行.跳过.map((x) => x.跳过原因)));
      const 报预 = 跑服务端({ action: "插图", allowWrite: true, 预期: { 集团: 8 }, 图: JSON.stringify([{ 表: "集团", 行: 5, 图片: 图 }]) }, 应用);
      断言(报预.written === false && /不等于预期/.test(报预.message), "预期末行不符 → 整批停手", String(报预.message));
      断言(集.单元.get("5:2").f === '=DISPIMG("ID_S1",1)', "预期不符时一个字节都不写（B5 原公式）", JSON.stringify(集.单元.get("5:2")));
    }

    // 14.4 无 allowWrite / 超 20 条 / 写图引用
    {
      const 集 = 造集团(); const 应用 = 造应用([造假表("汇总", {}), 集, 造假表(器械名, {})]);
      const 报无权 = 跑服务端({ action: "插图", 图: JSON.stringify([{ 表: "集团", 行: 5, 图片: 图 }]) }, 应用);
      断言(报无权.written === false && /allowWrite/.test(报无权.message), "没有 allowWrite → 拒", String(报无权.message));
      const 超条 = 跑服务端({ action: "插图", allowWrite: true, 图: JSON.stringify(Array.from({ length: 21 }, (_, i) => ({ 表: "集团", 行: 5, 图片: 图, i }))) }, 应用);
      断言(超条.written === false && /最多 20 条/.test(超条.message), "21 条 → 整批拒", String(超条.message));
      const 报引 = 跑服务端({ action: "写图引用", allowWrite: true, 预期: { 集团: 7 }, 引用: JSON.stringify([{ 表: "集团", 行: 5, 图片ID: "ID_AAA111" }]) }, 应用);
      断言(报引.written === true && 集.单元.get("5:2").f === '=DISPIMG("ID_AAA111",1)', "写图引用：B5 写成 =DISPIMG(\"ID_AAA111\",1)", JSON.stringify(集.单元.get("5:2")));
      const 坏ID = 跑服务端({ action: "写图引用", allowWrite: true, 引用: JSON.stringify([{ 表: "集团", 行: 5, 图片ID: "X_坏" }]) }, 应用);
      断言(坏ID.written === false && /没有可用的引用/.test(坏ID.message), "坏 ID（不是 ID_ 开头）→ 拒", String(坏ID.message));
    }
  }

  console.log(`\n  结果：${通过} 通过 / ${失败} 失败\n`);
  process.exitCode = 失败 ? 1 : 0;
}

主().catch((错误) => {
  console.error(`\n  测试崩溃：${错误 && 错误.stack ? 错误.stack : 错误}\n`);
  process.exitCode = 1;
});
