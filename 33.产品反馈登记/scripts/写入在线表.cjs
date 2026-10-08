#!/usr/bin/env node
// 33号 产品反馈登记：把「待写数据」写进《2026年【交接&跟进】表》『产品问题』子表。
//
// 数据通道：目标文档里贴好的 AirScript「产品问题-写入」（kdocs-scripts/AirScript-产品问题-写入.md，
// 普通 AirScript 即可，不需要 2.0 Beta）→ 本机存的同步 webhook。
// webhook / 令牌都不入库：project-config/kdocs-airscript.local.json（令牌回退链：本配置 → 7号）。
// 失败不自动重试（用户铁律）；每一步回读差异都必须为 0，否则停手报人。
//
// 用法：
//   node scripts/写入在线表.cjs --模式 探针                        # 只读：看表头/末行/空表
//   node scripts/写入在线表.cjs --模式 写表头                      # 仅在空表时写 9 列表头
//   node scripts/写入在线表.cjs --模式 预演 --数据 runtime/待写数据/2026-10-08.json
//   node scripts/写入在线表.cjs --模式 写入 --数据 runtime/待写数据/2026-10-08.json
//   node scripts/写入在线表.cjs --模式 全流程 --数据 runtime/待写数据/2026-10-08.json
//     全流程 = 探针 →（空表则写表头）→ 预演（expectedLastRow=实时末行）→ 写入 → 终验探针；
//     每一步的证据 JSON 落到 runtime/证据/<时间戳>/。
const fs = require("node:fs");
const path = require("node:path");
const { 项目根, 仓库根 } = require("./金山只读.cjs");

const 脚本键 = "write_product_issue";

function 读配置() {
  const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.local.json");
  if (!fs.existsSync(配置路径)) return { scripts: {} };
  return JSON.parse(fs.readFileSync(配置路径, "utf8"));
}

function 解析令牌配置(文件路径) {
  const 配置 = JSON.parse(fs.readFileSync(文件路径, "utf8"));
  if (配置.apiToken) return 配置.apiToken;
  const 相对 = 配置.tokenFallbackFile || 配置.apiTokenFallbackFile || "../12.店铺指标数据自动更新/project-config/platform-config.json";
  const 二级路径 = path.resolve(path.dirname(path.dirname(文件路径)), 相对);
  if (fs.existsSync(二级路径)) {
    const 二级配置 = JSON.parse(fs.readFileSync(二级路径, "utf8"));
    const 令牌 = (二级配置.kdocsDataSourceSync || {}).apiToken;
    if (令牌) return 令牌;
  }
  return "";
}

function 取令牌(配置) {
  if (配置.apiToken) return 配置.apiToken;
  const 回退 = path.resolve(项目根, 配置.apiTokenFallbackFile || "../2.发票自动化/7.自动登记发票/project-config/kdocs-airscript.json");
  if (fs.existsSync(回退)) return 解析令牌配置(回退);
  return "";
}

async function 调脚本(argv) {
  const 配置 = 读配置();
  const webhookUrl = String(((配置.scripts || {})[脚本键] || {}).webhookUrl || "").trim();
  if (!webhookUrl) {
    throw new Error(`还没配 webhook：等黎路遥在《2026年【交接&跟进】表》新建 AirScript 脚本「产品问题-写入」、` +
      `粘 kdocs-scripts/AirScript-产品问题-写入.md、生成同步 webhook 后，填进 33号 project-config/kdocs-airscript.local.json 的 scripts.${脚本键}.webhookUrl。`);
  }
  const 令牌 = 取令牌(配置);
  if (!令牌) throw new Error("缺少 AirScript-Token（本机配置或回退链里都没有）。");
  const 响应 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "AirScript-Token": 令牌 },
    body: JSON.stringify({ Context: { argv } }),
    signal: AbortSignal.timeout(300000)
  });
  const 文本 = await 响应.text();
  if (!响应.ok) throw new Error(`金山接口返回 HTTP ${响应.status}：${文本.slice(0, 300)}`);
  let 载荷 = null;
  try { 载荷 = JSON.parse(文本); } catch { throw new Error(`金山接口没有返回可解析的 JSON：${文本.slice(0, 300)}`); }
  if (载荷.error) throw new Error(`金山脚本报错：${String(载荷.error).slice(0, 500)}\n  原始响应：${文本.slice(0, 1500)}`);
  const 原始 = 载荷.data ? 载荷.data.result : 载荷.result;
  if (原始 === undefined || 原始 === null || 原始 === "[Undefined]") {
    throw new Error("金山脚本没有返回结果：确认脚本已保存，且最后一行是 return main()。");
  }
  return 原始;
}

function 解析参数(argv) {
  const 参数 = { 模式: "探针", 数据: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--模式") 参数.模式 = argv[i + 1];
    else if (argv[i] === "--数据") 参数.数据 = argv[i + 1];
  }
  return 参数;
}

function 落盘证据(目录, 名称, 数据) {
  fs.mkdirSync(目录, { recursive: true });
  const 文件 = path.join(目录, 名称 + ".json");
  fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...数据 }, null, 2), "utf8");
  return 文件;
}

function 读数据文件(路径) {
  const 全路径 = path.resolve(项目根, 路径 || "");
  if (!fs.existsSync(全路径)) throw new Error(`待写数据文件不存在：${全路径}（先备 runtime/待写数据/<日期>.json）`);
  return { 全路径, 数据: JSON.parse(fs.readFileSync(全路径, "utf8")) };
}

function 新证据目录() {
  const 时间戳 = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return path.join(项目根, "runtime", "证据", 时间戳);
}

async function 探针并校验(证据目录, 步名) {
  const 探 = await 调脚本({ probe: true });
  落盘证据(证据目录, 步名, 探);
  console.log(`  · 探针：表头就位=${探.headerOk}　表头为空=${探.headerEmpty}　数据末行=${探.lastRow}　数据行数=${探.dataRows}`);
  if (探.表头读不到数) throw new Error("表头格读不到，停下来问人");
  return 探;
}

async function 写入模式(参数, 证据目录, { 允许建表头 }) {
  const { 全路径, 数据 } = 读数据文件(参数.数据);
  if (!Array.isArray(数据.行) || !数据.行.length) throw new Error(`数据文件没有「行」数组：${全路径}`);
  console.log(`\n  33号 写入${允许建表头 ? "全流程" : ""}：${数据.日期}（${数据.行.length} 行），数据文件 ${path.relative(项目根, 全路径)}`);

  const 探 = await 探针并校验(证据目录, "1-探针");
  let 当前末行 = 探.lastRow;
  if (探.headerEmpty) {
    if (!允许建表头) throw new Error("表头还没建：先跑 --模式 写表头（或走 全流程）");
    if (探.lastRow) throw new Error(`表头为空但 A 列有数据（第 ${探.lastRow} 行），表形态怪，停手问人`);
    const 头 = await 调脚本({ 写表头: true, allowWrite: true });
    落盘证据(证据目录, "2-写表头", 头);
    if (!头.written || 头.回读差异数) throw new Error(`写表头失败/不一致：${JSON.stringify(头).slice(0, 500)}`);
    console.log("  · 写表头：9 列表头已写入，回读 0 差异");
    当前末行 = 0;
  } else if (!探.headerOk) {
    throw new Error(`表头与脚本定义不一致：${JSON.stringify(探.实际表头)}（要改列就先改脚本 表头 数组再重贴）`);
  }

  const 预 = await 调脚本({ dryRun: true, rows: 数据.行, expectedLastRow: 当前末行 });
  落盘证据(证据目录, "3-预演", 预);
  if (!预.通过) throw new Error(`预演不通过，停手：${预.原因}`);
  console.log(`  · 预演：通过，将写 ${预.将写行数} 行到第 ${预.将写起始行} 行起`);

  const 写 = await 调脚本({ rows: 数据.行, expectedLastRow: 当前末行, allowWrite: true });
  落盘证据(证据目录, "4-写入", 写);
  if (!写.written) throw new Error(`写入失败：${JSON.stringify(写).slice(0, 500)}`);
  if (写.mismatchedRows) throw new Error(`写入回读有 ${写.mismatchedRows} 格不一致：${写.firstMismatch}`);
  console.log(`  · 写入：第 ${写.firstRow}~${写.末行} 行，回读 0 差异`);

  const 终 = await 调脚本({ probe: true });
  落盘证据(证据目录, "5-终验探针", 终);
  const 应有末行 = 当前末行 + 写.rows;
  if (终.lastRow !== 应有末行) throw new Error(`终验不符：现有末行 ${终.lastRow}，应有 ${应有末行}`);
  console.log(`  · 终验：数据末行 ${终.lastRow}（应有 ${应有末行}），表头 ${终.headerOk ? "就位" : "异常"}`);
  console.log(`\n  完成。证据：${path.relative(项目根, 证据目录)}`);
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 证据目录 = 新证据目录();
  if (参数.模式 === "探针") {
    await 探针并校验(证据目录, "探针");
    console.log(`\n  证据：${path.relative(项目根, 证据目录)}`);
    return;
  }
  if (参数.模式 === "写表头") {
    const 探 = await 探针并校验(证据目录, "1-探针");
    if (!探.headerEmpty) {
      console.log(`  表头不是空的（就位=${探.headerOk}），没动。`);
      return;
    }
    if (探.lastRow) throw new Error(`表头为空但 A 列有数据（第 ${探.lastRow} 行），表形态怪，停手问人`);
    const 头 = await 调脚本({ 写表头: true, allowWrite: true });
    落盘证据(证据目录, "2-写表头", 头);
    if (!头.written || 头.回读差异数) throw new Error(`写表头失败/不一致：${JSON.stringify(头).slice(0, 500)}`);
    console.log("  写表头完成：9 列表头已写入，回读 0 差异。");
    console.log(`\n  证据：${path.relative(项目根, 证据目录)}`);
    return;
  }
  if (参数.模式 === "预演") {
    const { 数据 } = 读数据文件(参数.数据);
    const 探 = await 探针并校验(证据目录, "1-探针");
    const 预 = await 调脚本({ dryRun: true, rows: 数据.行, expectedLastRow: 探.lastRow });
    落盘证据(证据目录, "2-预演", 预);
    console.log(`  预演：通过=${预.通过}　${预.原因}　将写 ${预.将写行数} 行到第 ${预.将写起始行} 行起`);
    if (预.行预览) console.log(`  首行预览：${预.行预览}`);
    console.log(`\n  证据：${path.relative(项目根, 证据目录)}`);
    return;
  }
  if (参数.模式 === "写入") {
    await 写入模式(参数, 证据目录, { 允许建表头: false });
    return;
  }
  if (参数.模式 === "全流程") {
    await 写入模式(参数, 证据目录, { 允许建表头: true });
    return;
  }
  throw new Error(`未知模式：${参数.模式}（可用 探针|写表头|预演|写入|全流程）`);
}

main().catch((错) => {
  console.error(`\n  失败：${错.message}`);
  console.error("  失败不自动重试；先看现场再决定。\n");
  process.exitCode = 1;
});
