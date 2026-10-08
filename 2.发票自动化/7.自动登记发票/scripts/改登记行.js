// 7号 动作：**改已登记的行**（指定行、指定几列，值带类型）——一个动作：只改这几格。
// 为什么单独一个工具：scripts/写登记表.js 走「云端查重 → 命中拒写」，专治首登；
//   同一单改错/拆行时订单号已经存在，需要一个「按行号 + 指定列」的改正入口。
//   云端写入脚本（独立脚本 v2026-09-30.8 起）已支持 {row, writeCells}，本工具只是把四道闸做在本地。
//
// 用法：node scripts/改登记行.js --订单号 <单> --表 "<子表名>" --行 <行号> --改 U=DH22-C1L,Y=593.30 [--脚本 write] [--查脚本 query] --已确认
//   示例：node scripts/改登记行.js --订单号 260926-***********0863 --表 "德达医疗器械发票登记 --毛叶红" --行 2781 --改 U=DH22-C1L,Y=593.30 --已确认
//
// 四道闸（顺序不能改；任何一道不过 → 一个字节都不写）：
//   ① 身份核对（云端只读）：按行读该行，J 列必须 = --订单号；**J 为空的表尾新行**要追加两条：
//       --改 里必须同时写 J=本单号（身份由本次写入建立），且云端探针的 nextWriteRow 必须就是 --行
//       （防止打错行号把单写进中间的空行）。读请求与 `node scripts/查登记表.js --行 <行号> --脚本 <查脚本>` 一致。
//   ② 列白名单：只允许 A/F/G/I/J/K/L/O/U/V/Y/AA/AB/AK；公式列（C/D/E/M/T/W/X/AO）与其余列（含 S，走写同单备注.js）一律拒写。
//   ③ 类型：A/V/Y/AK 一律转数字再传（金额 593.30 不能当字符串写进去；A/AK 是日期序列号）。
//   ④ 云端写入 + 判据：written===true 且 failedColumns 空 且 **每个目标列**都在 writtenColumns（防云端静默跳过）。
//      写完再用只读查询回读该行，证据落 runtime/改行-<单>-行<行>-<时间戳>.json（runtime 不入库）。
//
// 缺 --已确认 / --改 解析失败 / 身份不符 → 拒写。本工具只改这几格，不碰别人的行、不碰公式列。
const path = require("path");
const fs = require("fs");
const { 跑脚本 } = require("../src/金山脚本客户端");

const 项目根 = path.resolve(__dirname, "..");
const 证据目录 = path.join(项目根, "runtime");

// 闸门②的两份名单：白名单 = 允许改的数据列（与云端可写列的交集）；
// 公式列 = 写进去会被覆盖的列（2026-09-30 踩过两次 T 列，公式列一律拒）。
const 列白名单 = ["A", "F", "G", "I", "J", "K", "L", "O", "U", "V", "Y", "AA", "AB", "AK"];
const 公式列 = ["C", "D", "E", "M", "T", "W", "X", "AO"];
// 闸门③：必须转数字的列（V=数量、Y=金额、A=登记日期序列号、AK=发货日期序列号）。
const 数字列 = ["A", "V", "Y", "AK"];

function 解析参数(argv) {
  const 结果 = { 订单号: "", 表名: "", 行: 0, 改: "", 脚本: "write", 查脚本: "", 已确认: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--订单号") { 结果.订单号 = argv[i + 1] || ""; i += 1; continue; }
    if (词 === "--表") { 结果.表名 = argv[i + 1] || ""; i += 1; continue; }
    if (词 === "--行") { 结果.行 = Number(argv[i + 1]) || 0; i += 1; continue; }
    if (词 === "--改") { 结果.改 = argv[i + 1] || ""; i += 1; continue; }
    if (词 === "--脚本") { 结果.脚本 = argv[i + 1] || ""; i += 1; continue; }
    if (词 === "--查脚本") { 结果.查脚本 = argv[i + 1] || ""; i += 1; continue; }
    if (词 === "--已确认") { 结果.已确认 = true; continue; }
  }
  return 结果;
}

function 检查参数(参数) {
  if (!参数.订单号) return { 错误: "缺少 --订单号" };
  if (!参数.表名) return { 错误: "缺少 --表" };
  if (!(Number(参数.行) > 0)) return { 错误: "缺少 --行（行号要是正整数）" };
  if (!参数.改) return { 错误: "缺少 --改（格式如 --改 U=DH22-C1L,Y=593.30）" };
  if (参数.已确认 !== true) return { 错误: "未授权：改表必须逐次授权，请加 --已确认" };
  return { 通过: true };
}

// 解析 --改 "U=DH22-C1L,Y=593.30"（也认中文逗号）；列名统一大写；重复列/没等号/空值都拒。
function 解析改列(文本) {
  const 片段 = String(文本 || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (!片段.length) return { 错误: "--改 是空的" };
  const 列 = {};
  for (const 段 of 片段) {
    const 匹配 = /^([A-Za-z]{1,2})\s*=\s*(.+)$/.exec(段);
    if (!匹配) return { 错误: `--改 的「${段}」解析不了；格式应为 列=值（如 U=DH22-C1L,Y=593.30）` };
    const 字母 = 匹配[1].toUpperCase();
    const 值 = 匹配[2].trim();
    if (!值) return { 错误: `--改 的 ${字母} 列值为空` };
    if (列[字母] !== undefined) return { 错误: `--改 里 ${字母} 列写了两次` };
    列[字母] = 值;
  }
  return { 列 };
}

function 检查列(列对象) {
  const 列名 = Object.keys(列对象 || {});
  if (!列名.length) return { 通过: false, 原因: "--改 里没有任何列" };
  for (const 列 of 列名) {
    if (公式列.indexOf(列) >= 0) return { 通过: false, 原因: `${列} 列是公式列（表里会自己算），一律拒写` };
    if (列白名单.indexOf(列) < 0) return { 通过: false, 原因: `${列} 列不在白名单（只允许 ${列白名单.join("/")}）` };
  }
  return { 通过: true };
}

function 转类型(列对象) {
  const 结果 = {};
  for (const [列, 值] of Object.entries(列对象 || {})) {
    if (数字列.indexOf(列) < 0) { 结果[列] = String(值); continue; }
    const 数 = Number(值);
    if (!Number.isFinite(数)) return { 错误: `${列} 列要求数字，给的是「${值}」` };
    结果[列] = 数;
  }
  return { 列: 结果 };
}

// 写脚本 → 读脚本（表① write→query；集团表 write_jituan→query_jituan）；不认识的必须显式 --查脚本。
function 推导查脚本(写脚本) {
  if (写脚本 === "write") return "query";
  if (写脚本 === "write_jituan") return "query_jituan";
  return "";
}

// 云端按行读的返回里，dump[].values 形如 ["U=DH22-C1L", "T=… ⟵ =BR2781&BT2781"]；取「 ⟵ 」前的值。
function 取行值(云端结果, 行号) {
  const 目标 = Number(行号);
  const 列表 = 云端结果 && Array.isArray(云端结果.dump) ? 云端结果.dump : [];
  const 命中 = 列表.filter((项) => Number(项 && 项.row) === 目标)[0] || null;
  if (!命中) return null;
  const 值 = {};
  for (const 原文 of 命中.values || []) {
    const 主段 = String(原文).split(" ⟵ ")[0];
    const 等号位置 = 主段.indexOf("=");
    if (等号位置 <= 0) continue;
    const 列 = 主段.slice(0, 等号位置).trim().toUpperCase();
    if (!/^[A-Z]{1,2}$/.test(列)) continue;
    if (值[列] === undefined) 值[列] = 主段.slice(等号位置 + 1);
  }
  return 值;
}

// 闸门①：J = 本单 → 过；J 空 → 只有 --改 同时写 J=本单 才过（表尾新行）；J 是别人的单 → 拒.
function 判定身份(云端结果, 行号, 订单号, 写入列) {
  const 行值 = 取行值(云端结果, 行号);
  if (!行值) return { 通过: false, 原因: `云端读不到第 ${行号} 行（返回里没有这一行），不写` };
  const 当前J = String(行值.J || "").trim();
  const 单 = String(订单号 || "").trim();
  if (!当前J) {
    const 拟写J = String((写入列 || {}).J || "").trim();
    if (拟写J === 单) return { 通过: true, 当前J: "", 说明: `第 ${行号} 行 J 为空（表尾新行），本次 --改 会写入 J=${单}` };
    return { 通过: false, 原因: `第 ${行号} 行 J 为空，且 --改 里没有 J=${单} → 无法确认是本单，拒写` };
  }
  if (当前J !== 单) return { 通过: false, 原因: `第 ${行号} 行 J=${当前J}，不是本单 ${单} → 拒绝覆盖` };
  return { 通过: true, 当前J };
}

// 表尾新行追加一道：云端探针的「下一个可写行」必须就是 --行（防打错行号写进中间空行）。
function 检查新行位置(探针结果, 行号) {
  const 下一个 = Number(探针结果 && 探针结果.nextWriteRow);
  if (!(下一个 > 0)) return { 通过: false, 原因: "云端探针没有回 nextWriteRow，无法确认表尾位置，拒写" };
  if (下一个 !== Number(行号)) return { 通过: false, 原因: `云端探针的下一个可写行是 ${下一个}，不是 --行 ${行号} → 拒绝往中间空行写` };
  return { 通过: true };
}

// 闸门④判据：只认 written===true；failedColumns 必须空；**每个**目标列都要在 writtenColumns 里。
// 反向断言（tests/改登记行.test.js 锁死）：带 status:'已写入' 但没有 written:true 的返回必须判失败。
function 判定写入(结果, 目标列) {
  const 列名单 = Array.isArray(目标列) ? 目标列 : [];
  if (!结果 || 结果.written !== true) {
    return { 成功: false, 状态: "写入失败", 原因: (结果 && 结果.message) || "云端没有返回 written:true（可能没写进去）" };
  }
  const 失败列 = Array.isArray(结果.failedColumns) ? 结果.failedColumns : [];
  if (失败列.length) {
    return { 成功: false, 状态: "写入失败", 原因: `${失败列.join("、")} 列没写进去（已写入：${(结果.writtenColumns || []).join("、") || "无"}）` };
  }
  const 写入列 = Array.isArray(结果.writtenColumns) ? 结果.writtenColumns : [];
  const 漏列 = 列名单.filter((列) => 写入列.indexOf(列) < 0);
  if (漏列.length) {
    return { 成功: false, 状态: "写入失败", 原因: `云端 writtenColumns=${JSON.stringify(写入列)} 里缺目标列 ${漏列.join("、")}——可能被云端静默跳过，请人工核对第 ${结果.row || "?"} 行` };
  }
  return { 成功: true, 状态: "已写入", 原因: "" };
}

function 生成请求(订单号, 表名, 行号, 写值) {
  return { orderNo: 订单号, row: Number(行号), writeCells: 写值, allowWrite: true, sheets: [表名] };
}

function 时间戳(现在 = new Date()) {
  const 补 = (n, 位 = 2) => String(n).padStart(位, "0");
  return `${现在.getFullYear()}${补(现在.getMonth() + 1)}${补(现在.getDate())}-${补(现在.getHours())}${补(现在.getMinutes())}${补(现在.getSeconds())}-${补(现在.getMilliseconds(), 3)}`;
}

function 落证据(数据) {
  try {
    fs.mkdirSync(证据目录, { recursive: true });
    const 单 = String(数据.订单号 || "未知").replace(/[^\w-]/g, "_");
    const 文件 = path.join(证据目录, `改行-${单}-行${数据.行}-${时间戳()}.json`);
    fs.writeFileSync(文件, JSON.stringify(数据, null, 2), "utf8");
    return 文件;
  } catch (_错误) {
    return "";
  }
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 参数检查 = 检查参数(参数);
  if (!参数检查.通过) {
    console.error('用法：node scripts/改登记行.js --订单号 <单> --表 "<子表名>" --行 <行号> --改 U=DH22-C1L,Y=593.30 [--脚本 write] [--查脚本 query] --已确认');
    console.error(`拒写：${参数检查.错误}`);
    process.exit(2);
  }
  const 解析 = 解析改列(参数.改);
  if (解析.错误) { console.error(`拒写：${解析.错误}`); process.exit(2); }
  const 列检查 = 检查列(解析.列);
  if (!列检查.通过) { console.error(`拒写：${列检查.原因}`); process.exit(2); }
  const 类型 = 转类型(解析.列);
  if (类型.错误) { console.error(`拒写：${类型.错误}`); process.exit(2); }
  const 写脚本 = 参数.脚本 || "write";
  const 查脚本 = 参数.查脚本 || 推导查脚本(写脚本);
  if (!查脚本) { console.error(`拒写：不认识写脚本「${写脚本}」，请显式给 --查脚本`); process.exit(2); }

  const 证据 = {
    时间: new Date().toISOString(),
    工具: "改登记行.js",
    订单号: 参数.订单号,
    表名: 参数.表名,
    行: Number(参数.行),
    写脚本,
    查脚本,
    命令: `node scripts/改登记行.js --订单号 ${参数.订单号} --表 "${参数.表名}" --行 ${参数.行} --改 "${参数.改}"${写脚本 !== "write" ? ` --脚本 ${写脚本}` : ""}${参数.查脚本 ? ` --查脚本 ${参数.查脚本}` : ""} --已确认`,
    writeCells: 类型.列,
  };

  // 闸门① 身份核对：按行读云端（与 `node scripts/查登记表.js --行 <行号> --脚本 <查脚本>` 同一请求）。
  const 查请求 = { keywords: [], maxRows: 20000, tailRows: 0, rowFrom: Number(参数.行), rowTo: Number(参数.行), withFormula: true };
  const 查结果 = await 跑脚本(查请求, { 脚本: 查脚本 });
  证据.写前行 = 取行值(查结果, 参数.行);
  const 身份 = 判定身份(查结果, 参数.行, 参数.订单号, 解析.列);
  证据.身份 = 身份;
  if (!身份.通过) {
    const 文件 = 落证据(证据);
    console.error(`\n  改登记行：身份核对不过 → 拒写\n  原因：${身份.原因}`);
    if (文件) console.error(`  证据：${path.relative(项目根, 文件)}`);
    process.exitCode = 3;
    return;
  }
  // J 为空 = 表尾新行：再核一道探针位置，防打错行号写进中间空行。
  if (!身份.当前J) {
    const 探针结果 = await 跑脚本({ probe: true, sheets: [参数.表名] }, { 脚本: 写脚本 });
    证据.探针 = 探针结果;
    const 位置 = 检查新行位置(探针结果, 参数.行);
    证据.新行位置 = 位置;
    if (!位置.通过) {
      const 文件 = 落证据(证据);
      console.error(`\n  改登记行：表尾位置核对不过 → 拒写\n  原因：${位置.原因}`);
      if (文件) console.error(`  证据：${path.relative(项目根, 文件)}`);
      process.exitCode = 3;
      return;
    }
  }

  // 闸门④ 云端写入（指定行；云端自己还会再验一次该行 J 为空或本单号）。
  const 请求 = 生成请求(参数.订单号, 参数.表名, 参数.行, 类型.列);
  证据.请求 = 请求;
  const 云端返回 = await 跑脚本(请求, { 脚本: 写脚本 });
  证据.云端返回 = 云端返回;
  const 判定 = 判定写入(云端返回, Object.keys(类型.列));
  证据.判定 = 判定;

  // 写后回读：云端 readBack 是截断展示，这里再用只读查询读一次整行落证据。
  try {
    const 写后 = await 跑脚本(查请求, { 脚本: 查脚本 });
    证据.写后行 = 取行值(写后, 参数.行);
  } catch (错误) {
    证据.写后行 = { 读取失败: String((错误 && 错误.message) || 错误) };
  }

  const 文件 = 落证据(证据);
  console.log(`\n  改登记行：状态=${判定.状态}`);
  console.log(`  订单号 ${参数.订单号}　表 ${参数.表名}　行 ${参数.行}　写脚本 ${写脚本}　查脚本 ${查脚本}`);
  console.log(`  写前身份：第 ${参数.行} 行 J=${身份.当前J || "(空)"}${身份.说明 ? `（${身份.说明}）` : ""}`);
  console.log(`  要写：${Object.entries(类型.列).map(([列, 值]) => `${列}=${值}(${typeof 值})`).join("、")}`);
  if (云端返回 && 云端返回.readBack) console.log(`  云端回读（截断展示）：${JSON.stringify(云端返回.readBack).slice(0, 240)}`);
  if (证据.写后行) console.log(`  写后再读：${JSON.stringify(证据.写后行).slice(0, 320)}`);
  if (!判定.成功) console.log(`  原因：${判定.原因}`);
  if (文件) console.log(`  证据：${path.relative(项目根, 文件)}`);
  console.log("");
  if (!判定.成功) process.exitCode = 4;
}

if (require.main === module) {
  main().catch((错误) => { console.log("失败：" + (错误 && 错误.message ? 错误.message : 错误)); process.exitCode = 1; });
}

module.exports = {
  解析参数, 检查参数, 解析改列, 检查列, 转类型, 推导查脚本,
  取行值, 判定身份, 检查新行位置, 判定写入, 生成请求,
  列白名单, 公式列, 数字列,
};
