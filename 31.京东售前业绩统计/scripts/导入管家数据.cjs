#!/usr/bin/env node
// 31号：把 京东客服管家「促成订单」导出文件 导入《京东客服询单业绩汇总（客服管家数据）》『明细』（在线追加）。
//
// 数据链：
//   客服管家【客服→店铺数据→营销明细→客服促成】导出「促成订单_<hash>.xlsx」（本机 Downloads/ 或 31号 runtime/downloads/）
//   → 本脚本：去「已取消」→ 去「(推算)」后缀 → 匹配客服实名（《客服昵称对应姓名》子表）
//   → 映射成 14 列（店铺｜年月｜咨询时间｜下单时间｜商品编号｜商品名称｜客服(昵称)｜客户｜所属订单编号｜
//      商品单价(?)｜购买数量｜订单状态｜客服(实名)｜种菜）
//   → POST 31号 AirScript「管家数据-追加写入」同步 webhook（**只追加、保留历史**；见《脚本大全》）。
//
// 用法：
//   node scripts/导入管家数据.cjs --file <促成订单xlsx> [--store 京东1店] --year-month 2026-09 [--dry-run|--send|--verify|--probe]
//   node scripts/导入管家数据.cjs --manifest <清单.json> [--dry-run|--send|--verify]
//   · 默认 --dry-run：只读源文件，打印统计 + 映射后前 3 行 + 实名匹配情况；不写云端。
//   · --send：分批 POST（默认每批 500 行），每批带 expectedLastRow 防重复；任一批 written=false 或回读有差异即停。
//   · --verify：读在线『明细』，按 店铺+年月 逐行核对（期望=源文件映射后行；查缺/多/重复）。
//   · --probe：调云端探针（看 lastRow/dataRows/表头是否就位），不写。
//   · --store 不给时按文件里客服昵称前缀自动识别（6 店前缀见下）；识别不出来会报错要你 --store。
//   · --batch 500 可调批次大小；--跳过前 N 用于续写（前面 N 行已写入，只补剩下）；
//     --只发 jd5s 只发指定店铺（补单店用；核对仍全量）；
//     --映射缓存 <路径> 换缓存文件；--刷新映射 强制重读《客服昵称对应姓名》。
//   清单格式：{"yearMonth":"2026-09","files":[{"file":"…xlsx","store":"京东1店"},{"file":"…xlsx"}]}
const fs = require("node:fs");
const path = require("node:path");
const XLSX = require(path.resolve(__dirname, "..", "..", "9.客服数据自动更新", "node_modules", "xlsx"));
const { 读工作表, 项目根, 仓库根 } = require("./金山只读.cjs");
const { 调脚本, 取webhook } = require("./AirScript调用.cjs");

const 目标表 = "管家表";
const 目标子表 = "明细";
const 表头 = ["店铺", "年月", "咨询时间", "下单时间", "商品编号", "商品名称", "客服", "客户", "所属订单编号", "商品单价(?)", "购买数量", "订单状态", "客服", "种菜"];
const 店铺前缀 = [
  ["德达官方旗舰店", "京东1店"],
  ["dedakj旗舰店", "京东2店"],
  ["dedakj器械店", "京东3店"],
  ["dedakj个护", "京东8店"],
  ["dedakj保健器械", "京东5S店"],
  ["dedakj自营", "京东6店"]
];
const 源列名 = ["咨询时间", "下单时间", "商品编号", "商品名称", "客服", "客户", "所属订单编号", "商品单价(?)", "购买数量", "订单状态"];

function 解析参数(argv) {
  const 参数 = { mode: "dry-run", file: "", manifest: "", store: "", yearMonth: "", batch: 500, 跳过前: 0, 只发: "", 映射缓存: "", 刷新映射: false, 帮助: false };
  for (let i = 0; i < argv.length; i += 1) {
    const 词 = argv[i];
    if (词 === "--file") { 参数.file = argv[i + 1] || ""; i += 1; }
    else if (词 === "--manifest") { 参数.manifest = argv[i + 1] || ""; i += 1; }
    else if (词 === "--store") { 参数.store = argv[i + 1] || ""; i += 1; }
    else if (词 === "--year-month") { 参数.yearMonth = argv[i + 1] || ""; i += 1; }
    else if (词 === "--batch") { 参数.batch = Number(argv[i + 1]) || 500; i += 1; }
    else if (词 === "--跳过前") { 参数.跳过前 = Number(argv[i + 1]) || 0; i += 1; }
    else if (词 === "--只发") { 参数.只发 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--映射缓存") { 参数.映射缓存 = argv[i + 1] || ""; i += 1; }
    else if (词 === "--刷新映射") 参数.刷新映射 = true;
    else if (词 === "--dry-run") 参数.mode = "dry-run";
    else if (词 === "--send") 参数.mode = "send";
    else if (词 === "--verify") 参数.mode = "verify";
    else if (词 === "--probe") 参数.mode = "probe";
    else if (词 === "--help" || 词 === "-h") 参数.帮助 = true;
  }
  return 参数;
}

function 用法() {
  console.log(`用法：
  node scripts/导入管家数据.cjs --file <促成订单xlsx> [--store 京东1店] --year-month 2026-09 [--dry-run|--send|--verify|--probe]
  node scripts/导入管家数据.cjs --manifest <清单.json> [--dry-run|--send|--verify] [--跳过前 N] [--只发 key]`);
}

function 读清单(参数) {
  if (参数.manifest) {
    const 清单 = JSON.parse(fs.readFileSync(参数.manifest, "utf8"));
    const files = (清单.files || []).map((f) => ({ file: f.file, store: f.store || "", key: f.key || "" }));
    if (!files.length) throw new Error("清单里 files 是空的");
    return { yearMonth: 参数.yearMonth || 清单.yearMonth || "", files };
  }
  if (!参数.file) throw new Error("要么 --file 单文件，要么 --manifest 清单");
  return { yearMonth: 参数.yearMonth, files: [{ file: 参数.file, store: 参数.store }] };
}

function 读xlsx(文件) {
  if (!fs.existsSync(文件)) throw new Error(`找不到源文件：${文件}`);
  const wb = XLSX.readFile(文件);
  const sheetName = wb.SheetNames.find((n) => n.includes("促成订单")) || wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, raw: true });
}

function 去空白(v) { return String(v ?? "").replace(/^[\s\u3000]+/, "").replace(/[\s\u3000]+$/, ""); }

// 取客服昵称的「店前缀」（"--" 或 "-" 前那一段）
function 取前缀(昵称) {
  const 文本 = 去空白(昵称).replace(/[（(]推算[）)]$/, "");
  const 段 = 文本.split("--");
  return 去空白((段.length > 1 ? 段[0] : 文本.split("-")[0]));
}

// 按源文件里出现最多的客服昵称前缀推断店铺
function 推断店铺(行列表, 文件) {
  const 票 = new Map();
  for (const 行 of 行列表) {
    const 前缀 = 取前缀(行[4]).toLowerCase();
    if (前缀) 票.set(前缀, (票.get(前缀) || 0) + 1);
  }
  const 排序 = [...票.entries()].sort((a, b) => b[1] - a[1]);
  for (const [前缀] of 排序) {
    const 命中 = 店铺前缀.find(([p]) => p.toLowerCase() === 前缀);
    if (命中) return 命中[1];
  }
  throw new Error(`无法从文件里的客服昵称推断店铺（样本：${行列表.slice(0, 3).map((r) => 去空白(r[4])).join(" / ")}），请加 --store。文件：${文件}`);
}

// —— 客服昵称 → 实名 匹配 ——
function 归一名字(值) {
  return 去空白(值)
    .replace(/[（(]推算[）)]$/, "")
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[—–─-]+/g, "");
}
function 基础名(值) {
  const 文本 = 去空白(值).replace(/[（(]推算[）)]$/, "");
  const 段 = 文本.split("--").pop().split("-").pop();
  return 去空白(段);
}

function 读映射缓存(参数) {
  const 缓存路径 = 参数.映射缓存 || path.join(项目根, "runtime", "映射-客服昵称.json");
  if (!参数.刷新映射 && fs.existsSync(缓存路径)) {
    return { 路径: 缓存路径, 数据: JSON.parse(fs.readFileSync(缓存路径, "utf8")) };
  }
  console.log("  正在读《客服昵称对应姓名》+ 表A现有行 生成映射（首次/刷新会慢一点）…");
  const 映射 = 读工作表({ 表: 目标表, 工作表: "客服昵称对应姓名" });
  const 明细 = 读工作表({ 表: 目标表, 工作表: 目标子表 });
  const pairs = [];
  for (const 行 of 映射.矩阵) {
    const 全称 = 去空白(行[2]);
    const 实名 = 去空白(行[3]);
    if (全称 && 实名) pairs.push([全称, 实名]);
  }
  for (const 行 of 明细.矩阵.slice(1)) {
    const 昵称 = 去空白(行[6]);
    const 实名 = 去空白(行[12]);
    if (昵称 && 实名 && !昵称.includes("推算")) pairs.push([昵称, 实名]);
  }
  const 数据 = { updatedAt: new Date().toISOString(), count: pairs.length, pairs };
  fs.mkdirSync(path.dirname(缓存路径), { recursive: true });
  fs.writeFileSync(缓存路径, JSON.stringify(数据, null, 1), "utf8");
  return { 路径: 缓存路径, 数据 };
}

// 建匹配器：全称优先 → 基础名（不冲突才用） → 本身就是实名
function 建匹配器(缓存数据) {
  const 全称表 = new Map();
  const 基础名表 = new Map(); // 基础名 -> Set(实名)
  const 实名集合 = new Set();
  for (const [昵称, 实名] of 缓存数据.pairs) {
    const 全 = 归一名字(昵称);
    if (全 && !全称表.has(全)) 全称表.set(全, 实名);
    const 基 = 归一名字(基础名(昵称));
    if (基) {
      if (!基础名表.has(基)) 基础名表.set(基, new Set());
      基础名表.get(基).add(实名);
    }
    实名集合.add(实名);
  }
  const 唯一基础名 = new Map();
  for (const [基, 集] of 基础名表) if (集.size === 1) 唯一基础名.set(基, [...集][0]);
  return {
    全称表, 唯一基础名, 实名集合,
    匹配(昵称) {
      const 原 = 去空白(昵称);
      if (!原) return "";
      if (实名集合.has(原)) return 原;
      const 全 = 归一名字(原);
      if (全称表.has(全)) return 全称表.get(全);
      const 基 = 归一名字(基础名(原));
      if (唯一基础名.has(基)) return 唯一基础名.get(基);
      return "";
    }
  };
}

// 读一个源文件 → 映射后的 14 列行 + 统计。返回 { store, rows, 统计, 未匹配 }
function 处理文件(文件, 店铺, 年月, 匹配器) {
  const 原始 = 读xlsx(文件);
  if (原始.length < 2) throw new Error(`源文件没有数据行：${文件}`);
  const 表头行 = 原始[0].map((v) => 去空白(v));
  const 列号 = {};
  for (const 名 of 源列名) {
    const idx = 表头行.indexOf(名);
    if (idx < 0) throw new Error(`源文件表头里没有「${名}」（实际：${表头行.join("、")}）。文件：${文件}`);
    列号[名] = idx;
  }
  const 行列表 = 原始.slice(1).filter((行) => 行.some((v) => 去空白(v)));
  const 统计 = { 源总行: 行列表.length, 已取消: 0, 整行重复: 0, 未匹配: [] };
  const 用店铺 = 店铺 || 推断店铺(行列表, 文件);
  const seen = new Set();
  const rows = [];
  for (const 行 of 行列表) {
    const 状态 = 去空白(行[列号["订单状态"]]);
    if (状态.includes("取消")) { 统计.已取消 += 1; continue; }
    const 昵称 = 去空白(行[列号["客服"]]);
    const 实名 = 匹配器.匹配(昵称);
    if (!实名) { 统计.未匹配.push(`${去空白(行[列号["所属订单编号"]])} ${昵称}`); continue; }
    const 单价 = typeof 行[列号["商品单价(?)"]] === "number" ? 行[列号["商品单价(?)"]] : Number(String(行[列号["商品单价(?)"]] ?? "").replace(/,/g, "")) || 0;
    const 数量 = typeof 行[列号["购买数量"]] === "number" ? 行[列号["购买数量"]] : Number(String(行[列号["购买数量"]] ?? "").replace(/,/g, "")) || 0;
    const 行数据 = [
      用店铺, 年月,
      去空白(行[列号["咨询时间"]]), 去空白(行[列号["下单时间"]]),
      去空白(行[列号["商品编号"]]), 去空白(行[列号["商品名称"]]),
      // 入库昵称去掉系统打的「(推算)」后缀（与表内历史行一致，2026-10-07 对比 8 月批次确认）
      昵称.replace(/[（(]推算[）)]$/, ""), 去空白(行[列号["客户"]]),
      去空白(行[列号["所属订单编号"]]), 单价, 数量,
      状态, 实名, ""
    ];
    const 键 = JSON.stringify(行数据);
    if (seen.has(键)) { 统计.整行重复 += 1; continue; }
    seen.add(键);
    rows.push(行数据);
  }
  if (统计.未匹配.length) {
    throw new Error(`有 ${统计.未匹配.length} 行客服昵称匹配不到实名（前 5 条：${统计.未匹配.slice(0, 5).join("；")}）。` +
      `先人工核对《客服昵称对应姓名》，或加 --刷新映射 重读映射。文件：${文件}`);
  }
  return { store: 用店铺, rows, 统计 };
}

function 加载全部(参数, 清单) {
  if (!清单.yearMonth) throw new Error("缺 --year-month（如 2026-09）：年月不能从下单时间推断（批次跨月）。");
  const { 数据: 缓存 } = 读映射缓存(参数);
  const 匹配器 = 建匹配器(缓存);
  const 结果 = [];
  let 总行 = 0;
  for (const 条目 of 清单.files) {
    const 处理 = 处理文件(条目.file, 条目.store, 清单.yearMonth, 匹配器);
    结果.push({ 文件: 条目.file, ...处理 });
    总行 += 处理.rows.length;
    console.log(`  · ${path.basename(条目.file)} → ${处理.store}：源 ${处理.统计.源总行} 行，去已取消 ${处理.统计.已取消}，整行重复 ${处理.统计.整行重复}，入库 ${处理.rows.length} 行`);
  }
  console.log(`  合计入库：${总行} 行（年月=${清单.yearMonth}）`);
  const 全部行 = 结果.flatMap((r) => r.rows);
  // 跨文件重查：同一单同商品在两份文件里重复出现 → 可能是同一批导了两次，停下让人核。
  const 键计数 = new Map();
  for (const 行 of 全部行) {
    const 键 = 记录键(行);
    键计数.set(键, (键计数.get(键) || 0) + 1);
  }
  const 重 = [...键计数.entries()].filter(([, n]) => n > 1);
  if (重.length) throw new Error(`发现 ${重.length} 个键在多份文件里重复（前 3：${重.slice(0, 3).map(([k, n]) => `${k}×${n}`).join("；")}），停止导入，人工核对文件是否重复导出。`);
  return { 结果, 全部行 };
}

// —— 文件 → 记录的键（用于回读核对）——
function 记录键(行) { return `${去空白(行[0])}|${去空白(行[8])}|${去空白(行[4])}`; }

async function 探针() {
  const 结果 = await 调脚本("append_guanjia", { probe: true });
  console.log(`  云端探针：${JSON.stringify(结果)}`);
  return 结果;
}

async function 发送(全部行, 批次 = 500) {
  if (!取webhook("append_guanjia")) {
    throw new Error("等黎路遥粘贴后补 webhook：把《脚本大全》「管家数据-追加写入」那行粘到《京东客服询单业绩汇总（客服管家数据）》的 AirScript，生成同步 webhook，" +
      "填进 31号 project-config/kdocs-airscript.local.json 的 scripts.append_guanjia.webhookUrl。");
  }
  const 探 = await 调脚本("append_guanjia", { probe: true });
  if (!探.headerOk) throw new Error(`云端表头没就位（probe=${JSON.stringify(探)}），拒绝写入。`);
  let 末行 = 探.lastRow;
  console.log(`  写入前：在线数据 ${探.dataRows} 行，末行 ${末行}；本批 ${全部行.length} 行，每批 ${批次} 行。`);
  for (let i = 0; i < 全部行.length; i += 批次) {
    const 块 = 全部行.slice(i, i + 批次);
    const 结果 = await 调脚本("append_guanjia", { rows: 块, allowWrite: true, expectedLastRow: 末行 });
    if (!结果.written || 结果.rows !== 块.length) throw new Error(`第 ${i / 批次 + 1} 批写入失败：${JSON.stringify(结果).slice(0, 400)}`);
    if (结果.mismatchedRows) throw new Error(`第 ${i / 批次 + 1} 批回读有 ${结果.mismatchedRows} 行不一致（${结果.firstMismatch}），停下人工核对。`);
    末行 = 结果.lastRow;
    console.log(`  · 批 ${i / 批次 + 1}：写 ${结果.rows} 行（第 ${结果.firstRow}~${结果.lastRow} 行），回读比对 0 差异`);
  }
  console.log(`  写入完成：末行 ${末行}。`);
  return 末行;
}

function 读在线明细() {
  return 读工作表({ 表: 目标表, 工作表: 目标子表 });
}

function 核对(全部行, 年月) {
  const 在线 = 读在线明细().矩阵;
  const 在线计数 = new Map();
  let 在线行数 = 0;
  for (const 行 of 在线.slice(1)) {
    if (去空白(行[1]) !== 年月) continue;
    在线行数 += 1;
    const 键 = 记录键(行);
    在线计数.set(键, (在线计数.get(键) || 0) + 1);
  }
  const 期望计数 = new Map();
  for (const 行 of 全部行) {
    const 键 = 记录键(行);
    期望计数.set(键, (期望计数.get(键) || 0) + 1);
  }
  let 缺 = 0; let 多 = 0; let 重复 = 0;
  const 缺样本 = []; const 多样本 = [];
  for (const [键, 次] of 期望计数) {
    const 有 = 在线计数.get(键) || 0;
    if (!有) { 缺 += 1; if (缺样本.length < 3) 缺样本.push(`${键}(期望${次})`); }
  }
  for (const [键, 次] of 在线计数) {
    if (!期望计数.has(键)) { 多 += 1; if (多样本.length < 3) 多样本.push(`${键}(在线${次})`); }
    if (次 > 1) 重复 += 1;
  }
  console.log(`  核对「${年月}」：期望 ${全部行.length} 行 / 在线 ${在线行数} 行；缺 ${缺} 行，多 ${多} 行，重复 ${重复} 行`);
  if (缺样本.length) console.log(`    缺样本：${缺样本.join("；")}`);
  if (多样本.length) console.log(`    多样本：${多样本.join("；")}`);
  return { 期望: 全部行.length, 在线: 在线行数, 缺, 多, 重复 };
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (参数.帮助) { 用法(); return; }
  if (参数.mode === "probe") {
    await 探针();
    return;
  }
  const 清单 = 读清单(参数);
  console.log(`  模式=${参数.mode} 年月=${清单.yearMonth || "(未给)"} 文件数=${清单.files.length}`);
  const { 结果: 文件结果, 全部行 } = 加载全部(参数, 清单);
  if (参数.mode === "dry-run") {
    console.log(`\n  映射后前 3 行：`);
    for (const 行 of 全部行.slice(0, 3)) console.log("    " + JSON.stringify(行));
    if (取webhook("append_guanjia")) {
      try {
        const 探 = await 调脚本("append_guanjia", { probe: true });
        console.log(`  云端现状（探针）：数据 ${探.dataRows} 行，末行 ${探.lastRow}，表头就位=${探.headerOk}`);
      } catch (error) { console.log(`  （云端探针失败：${error.message}）`); }
    } else {
      console.log("  （还没配 webhook：等黎路遥粘贴后补，dry-run 到此为止）");
    }
    return;
  }
  if (参数.mode === "send") {
    // --只发 key[,key]：只发指定店铺的行（核对仍用全量，适合补单店）；--跳过前 N：续写（前面 N 行已写入）
    let 发送行 = 全部行.slice(参数.跳过前);
    if (参数.只发) {
      const 要发 = new Set(参数.只发.split(",").map((s) => s.trim()).filter(Boolean));
      发送行 = 文件结果.flatMap((r, i) => 要发.has((清单.files[i] || {}).key) ? r.rows : []);
      console.log(`  （只发模式：只发 ${参数.只发}，共 ${发送行.length} 行；核对仍用全部 ${全部行.length} 行）`);
    } else if (参数.跳过前) {
      console.log(`  （续写模式：跳过前 ${参数.跳过前} 行，只发后 ${发送行.length} 行；核对仍用全部 ${全部行.length} 行）`);
    }
    await 发送(发送行, 参数.batch);
    const 结果 = 核对(全部行, 清单.yearMonth);
    if (结果.缺 || 结果.多 || 结果.重复) throw new Error("写入后核对不一致，停下人工核对。");
    console.log("  写入后核对通过：应有=实有。");
    return;
  }
  if (参数.mode === "verify") {
    const 结果 = 核对(全部行, 清单.yearMonth);
    if (结果.缺 || 结果.多 || 结果.重复) throw new Error("核对不一致，停下人工核对。");
    console.log("  核对通过：应有=实有。");
    return;
  }
  throw new Error(`未知模式：${参数.mode}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`\n  失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 解析参数, 读清单, 加载全部, 处理文件, 读映射缓存, 建匹配器, 发送, 核对, 探针, 记录键, 目标表, 目标子表, 表头, 店铺前缀, 源列名, 去空白 };
