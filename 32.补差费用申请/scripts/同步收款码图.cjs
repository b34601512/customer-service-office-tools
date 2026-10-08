#!/usr/bin/env node
// 32号 补差费用申请：收款码截图「一键同步」——带图清单 → 导缩略图 → 一把插图 → 只读回读校验。
//
// 每月流程（黎路遥 2026-10-08 定；缩略图口径见 15:57）：准备月度数据（写主体/刷新税金）之后、人工网页看之前，跑这一条：
//   node scripts/同步收款码图.cjs --批次 runtime/待写数据/2026-10.json
// 它会：
//   ① 从批次文件**自动**生成带图清单（明细[].汇总行[2] 是 =DISPIMG(…) 的行）→ <出>/清单.json；
//   ② 调 导出收款码图.cjs --缩略图（默认宽 320px/q0.75，每张从该行自己的原图缩）导 dataURL（带目标行）；
//   ③ 用 24号 只读回读目标表《汇总》C 列，**只插图还没插的行**（换过图 ID = 已插；还是批次里的源图 ID = 待插）；
//   ④ 整批一把插图（--每批 N 可拆；失败不重试），再只读回读逐格核对（期望新图 ID），并给出全表差异行。
// 参数：
//   --批次 <待写数据.json>   必填（准备月度数据.cjs 产出；必须带 预期末行.汇总）
//   --出 <目录>              可选，默认 runtime/收款码图/<批次的月份>
//   --宽 / --质量 / --单张上限KB   可选，缩略图参数（默认 320 / 0.75 / 60）
//   --每批 N                 可选，插图拆成 N 张一批（默认 0=整批一把）
//   --预演                   只做 清单→导图→回读分拣，打印待插计划，**不插图**（安全验收用）
//   --重插                   已插过的行也重新插（默认跳过，避免把已确认的图再换一次）
// 退出码：0 = 全部待插行成功且回读一致；1 = 有失败/回读不符；2 = 参数或前置条件不对。
// 红线（用户口径）：不自动重试；只写目标表 C 列（插图动作自带 DISPIMG 守卫 + 批次行域）；
//   不碰历史记录；runtime 不入库；临时脚本用完即删（本工具入 README 常驻）。
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { 读批次 } = require("./批次映射.cjs");
const { 解析DISPIMG, 从批次生成清单, 按回读分拣, 写清单 } = require("./收款码图清单.cjs");
const { 规整插图文, 执行插图序列, 落盘证据 } = require("./写入在线表.cjs");

const 项目根 = path.resolve(__dirname, "..");
const 二十四号 = path.resolve(项目根, "..", "24.平台退款复查");

function 解析参数(argv) {
  const 参数 = { 批次: "", 出: "", 预演: false, 重插: false, 宽: "", 质量: "", 单张上限KB: "", 每批: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--预演") { 参数.预演 = true; continue; }
    if (k === "--重插") { 参数.重插 = true; continue; }
    if (k === "--批次") 参数.批次 = String(argv[++i] || "");
    else if (k === "--出") 参数.出 = String(argv[++i] || "");
    else if (k === "--宽") 参数.宽 = String(argv[++i] || "");
    else if (k === "--质量") 参数.质量 = String(argv[++i] || "");
    else if (k === "--单张上限KB") 参数.单张上限KB = String(argv[++i] || "");
    else if (k === "--每批") 参数.每批 = String(argv[++i] || "");
    else if (!k.startsWith("--")) 参数.批次 = k; // 容错：位置参数=批次文件
  }
  return 参数;
}

function 读链接(key) {
  const 配置 = JSON.parse(fs.readFileSync(path.join(项目根, "project-config", "links.local.json"), "utf8"));
  const url = String(配置[key] || "").trim();
  if (!url) throw new Error(`project-config/links.local.json 里没有「${key}」`);
  return url;
}

// 24号 只读回读目标表《汇总》→ matrix（新鲜数据；别用金山匿名页的隐藏表快照判图）
function 回读汇总(输出文件) {
  fs.mkdirSync(path.dirname(输出文件), { recursive: true });
  const r = spawnSync(process.execPath, [
    "src/tools/read-kdocs.js", "--url", 读链接("好评返现汇总表"), "--sheet", "汇总", "--out", 输出文件
  ], { cwd: 二十四号, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`24号 只读回读失败（退出码 ${r.status}），停手不插图`);
  const 载荷 = JSON.parse(fs.readFileSync(输出文件, "utf8"));
  if (!Array.isArray(载荷.matrix)) throw new Error("24号 回读结果里没有 matrix");
  return 载荷.matrix;
}

// 全表差异（只用于报告/守门：插过的图之外不该有变化）
function 矩阵差异(前, 后) {
  const 差异 = [];
  const 总行 = Math.max(前.length, 后.length);
  for (let r = 0; r < 总行; r += 1) {
    const a = Array.isArray(前[r]) ? 前[r] : [];
    const b = Array.isArray(后[r]) ? 后[r] : [];
    const 总列 = Math.max(a.length, b.length);
    for (let c = 0; c < 总列; c += 1) {
      const x = String(a[c] == null ? "" : a[c]);
      const y = String(b[c] == null ? "" : b[c]);
      if (x !== y) 差异.push({ 行: r + 1, 列: c + 1, 前: x.slice(0, 80), 后: y.slice(0, 80) });
    }
  }
  return 差异;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  if (!参数.批次) {
    console.error("用法：node scripts/同步收款码图.cjs --批次 <待写数据.json> [--出 <目录>] [--预演] [--重插]");
    process.exitCode = 2;
    return;
  }
  const 批次文件 = path.resolve(项目根, 参数.批次);
  if (!fs.existsSync(批次文件)) { console.error(`批次文件不存在：${批次文件}`); process.exitCode = 2; return; }
  const 批次 = JSON.parse(fs.readFileSync(批次文件, "utf8"));
  const 批 = 读批次(批次, 批次文件); // 缺 预期末行/行数/源行号 在这里就抛
  const 清单 = 从批次生成清单(批次, { 文件: 批次文件 });
  const 出目录 = path.resolve(项目根, 参数.出 || path.join("runtime", "收款码图", 清单.月份 || path.basename(批次文件, ".json")));
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = path.join(项目根, "runtime", "证据", `${时间戳}-同步收款码图`);
  fs.mkdirSync(出目录, { recursive: true });
  const 清单文件 = 写清单(path.join(出目录, "清单.json"), 清单);

  console.log(`\n  32号 收款码图同步：批次 ${清单.月份 || path.basename(批次文件)}（写前置末 ${批.写前置末}，目标行 ${批.目标首行}~${批.目标末行}）`);
  console.log(`  带图清单：${清单.有图行数}/${清单.行数} 行 → ${path.relative(项目根, 清单文件)}`);
  for (const 一 of 清单.项) console.log(`    · 源R${一.源行} ${一.姓名} → 目标行 ${一.目标行}（${一.id}）`);

  if (!清单.有图行数) {
    console.log(`\n  本批没有 =DISPIMG 图行，无需同步。\n`);
    return;
  }

  // ① 导缩略图（匿名无头，只读源表；每张从该行自己的原图缩，不搬原图、不用占位图）
  console.log(`\n  ── 第 1 步/4：导缩略图（源表 G 列单元格图 → 本机缩略图 + dataURL，带目标行）`);
  const 导参 = [path.join(__dirname, "导出收款码图.cjs"), "--清单", 清单文件, "--批次", 批次文件, "--出", 出目录, "--缩略图"];
  for (const [名, 值] of [["--宽", 参数.宽], ["--质量", 参数.质量], ["--单张上限KB", 参数.单张上限KB]]) {
    if (值) 导参.push(名, 值);
  }
  const 导 = spawnSync(process.execPath, 导参, { stdio: "inherit" });
  if (导.status !== 0) throw new Error(`导出收款码图.cjs 退出码 ${导.status}，停手（失败不重试）`);
  const dataURL文件 = path.join(出目录, "dataURL.json");
  if (!fs.existsSync(dataURL文件)) throw new Error(`导出工具没有产出 ${dataURL文件}`);
  const 导出数据 = JSON.parse(fs.readFileSync(dataURL文件, "utf8"));
  const 导出错 = (Array.isArray(导出数据) ? 导出数据 : []).filter((x) => x && x.错误);
  if (!Array.isArray(导出数据) || 导出数据.length !== 清单.有图行数 || 导出错.length) {
    throw new Error(`导图不完整：应有 ${清单.有图行数} 张、实得 ${Array.isArray(导出数据) ? 导出数据.length : 0} 张、失败 ${导出错.length} 张（停手）`);
  }

  // ② 只读回读，分拣「已插 / 待插」
  console.log(`\n  ── 第 2 步/4：只读回读目标表，分拣已插/待插`);
  const 前回读 = path.join(证据目录, "同步-回读-前.json");
  const 前矩阵 = 回读汇总(前回读);
  const 分拣 = 按回读分拣(前矩阵, 清单.项);
  const 待插 = 参数.重插 ? 清单.项.map((x) => ({ ...x, 当前值: (前矩阵[x.目标行 - 1] || [])[2] || "" })) : 分拣.待插;
  console.log(`  已插过（跳过）：${分拣.已插.length} 行${分拣.已插.length ? "（" + 分拣.已插.map((x) => x.目标行).join("/") + "）" : ""}${参数.重插 ? "；--重插：仍然重插" : ""}`);
  console.log(`  待插：${待插.length} 行${待插.length ? "（" + 待插.map((x) => x.目标行).join("/") + "）" : ""}`);
  for (const 一 of 分拣.已插) console.log(`    · 目标行 ${一.目标行} ${一.姓名}：回读已是 DISPIMG(${解析DISPIMG(一.当前值) || "?"}) ≠ 源图 ${一.id} → 判已插`);
  for (const 一 of 分拣.待插) console.log(`    · 目标行 ${一.目标行} ${一.姓名}：回读 C=${一.当前值.slice(0, 60) || "(空)"} → 待插`);

  const 计划 = { 时间: new Date().toISOString(), 批次: path.relative(项目根, 批次文件), 出目录: path.relative(项目根, 出目录), 清单, 待插: 待插.map((x) => x.目标行), 已插: 分拣.已插.map((x) => x.目标行), 重插: 参数.重插 };
  落盘证据(证据目录, "同步-计划", 计划);

  if (参数.预演) {
    console.log(`\n  预演结束（没有插图）。证据：${path.relative(项目根, 证据目录)}\n`);
    return;
  }

  // ③ 插图（只插待插行；默认整批一把、失败不重试）
  let 插入结果 = { 成功: 0, 总数: 0, 批次: [], 行结果: [] };
  if (待插.length) {
    console.log(`\n  ── 第 3 步/4：插图（${待插.length} 张）`);
    const 规 = 规整插图文(导出数据, 批);
    const 待插行集 = new Set(待插.map((x) => x.目标行));
    const 图 = 规.图.filter((x) => 待插行集.has(x.行));
    if (图.length !== 待插.length) throw new Error(`待插 ${待插.length} 行与导出数据里可写 ${图.length} 张对不上，停手`);
    插入结果 = await 执行插图序列(图, 规, 证据目录, { 每批: 参数.每批 });
  } else {
    console.log(`\n  ── 第 3 步/4：没有待插行，跳过插图`);
  }

  // ④ 只读回读校验：插入行必须等于服务端回报的新图 ID；跳过的行必须没变
  console.log(`\n  ── 第 4 步/4：只读回读校验`);
  const 后回读 = path.join(证据目录, "同步-回读-后.json");
  const 后矩阵 = 回读汇总(后回读);
  const 差异 = 矩阵差异(前矩阵, 后矩阵);
  let 不符 = 0;
  const 期望图ID = new Map();
  for (const 一 of 插入结果.行结果 || []) {
    if (!一.合格) { 不符 += 1; console.log(`    ✗ 目标行 ${一.行}：插图未成功（${一.跳过原因 || 一.插入报错 || "看 7-插图-批量 证据"}）`); continue; }
    const 期望ID = 解析DISPIMG(一.新公式);
    if (!期望ID) { 不符 += 1; console.log(`    ✗ 目标行 ${一.行}：服务端回报的新公式里没有 DISPIMG ID：${String(一.新公式).slice(0, 70)}`); continue; }
    期望图ID.set(一.行, 期望ID);
  }
  for (const [行, 期望ID] of 期望图ID) {
    const 实际 = String(((后矩阵[行 - 1] || [])[2]) || "").trim();
    const 实际ID = 解析DISPIMG(实际);
    if (实际ID === 期望ID) console.log(`    ✓ 目标行 ${行}：回读 DISPIMG(${实际ID}) = 插图回报`);
    else { 不符 += 1; console.log(`    ✗ 目标行 ${行}：回读 ${实际.slice(0, 70) || "(空)"}，期望 DISPIMG(${期望ID})`); }
  }
  for (const 一 of 分拣.已插) {
    const 前值 = String(一.当前值);
    const 后值 = String(((后矩阵[一.目标行 - 1] || [])[2]) || "").trim();
    if (前值 === 后值) console.log(`    ✓ 目标行 ${一.目标行}：已插行未动`);
    else { 不符 += 1; console.log(`    ✗ 目标行 ${一.目标行}：已插行被改了！前 ${前值.slice(0, 50)} → 后 ${后值.slice(0, 50)}`); }
  }
  const 意外差异 = 差异.filter((x) => !(x.列 === 3 && (插入结果.行结果 || []).some((y) => y.合格 && y.行 === x.行)));
  console.log(`  全表差异 ${差异.length} 格${差异.length ? "（行 " + [...new Set(差异.map((x) => x.行))].join("/") + "）" : ""}；本轮插图 ${插入结果.成功}/${插入结果.总数}，回读不符 ${不符}（含插图失败行）`);
  if (意外差异.length) console.log(`    ⚠ 意外差异（不在本轮插图行的 C 列）：${JSON.stringify(意外差异.slice(0, 10))}`);
  落盘证据(证据目录, "同步-汇总", {
    批次: path.relative(项目根, 批次文件), 出目录: path.relative(项目根, 出目录),
    清单有图行数: 清单.有图行数, 待插行: 计划.待插, 已插行: 计划.已插,
    插图成功: 插入结果.成功, 插图总数: 插入结果.总数, 回读不符: 不符,
    全表差异格数: 差异.length, 意外差异
  });

  if (不符 || 插入结果.成功 !== 插入结果.总数 || 意外差异.length) {
    console.error(`\n  同步未完全达成：插图 ${插入结果.成功}/${插入结果.总数}、回读不符 ${不符}、意外差异 ${意外差异.length}。证据：${path.relative(项目根, 证据目录)}\n`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n  同步完成：待插 ${待插.length} 行全部成功且回读一致。证据：${path.relative(项目根, 证据目录)}\n`);
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 解析参数, 矩阵差异, 回读汇总 };
