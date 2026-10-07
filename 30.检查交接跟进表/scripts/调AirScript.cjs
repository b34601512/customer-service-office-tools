#!/usr/bin/env node
// 30号 通用 AirScript 调用器：把请求 POST 到本机配置里的同步 webhook，打印+落盘结果。
//
// 用法：
//   node scripts/调AirScript.cjs --脚本 clean_dh_k|tick_completed [--模式 probe|试|dry-run|写]
//     · probe   → { probe:true }（只读）
//     · 试      → { 试:<试名> }（只读小测，tick_completed 专用；试名见脚本头注释；写试除外，写试只动指定空行且净变化为零）
//     · dry-run → { dryRun:true }（只读，回将改动清单；可加 --候选行 "1319,2060"）
//     · 写      → { allowWrite:true }（真写；写入前先 probe/dry-run；可加 --候选行）
//   另：--试名 <名>、--候选行 "行1,行2"、--写试行 <行号>、--已核实（配合 --候选行：跳过渠道状态检查，外部查实后用）
//   默认 --模式 probe。
//   · webhook 从 project-config/kdocs-airscript.local.json 的 scripts.<脚本>.webhookUrl 取；
//     令牌链同 30号 惯例（本配置 → 7号 → 12号）。失败不自动重试。

const fs = require("node:fs");
const path = require("node:path");
const { 项目根, 仓库根 } = require("./金山只读.cjs");

function 读金山配置() {
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

async function main() {
  const 参数 = { 脚本: "", 模式: "probe", 试名: "", 候选行: "", 写试行: "", 已核实: false };
  const 词表 = process.argv.slice(2);
  for (let i = 0; i < 词表.length; i += 1) {
    if (词表[i] === "--脚本") 参数.脚本 = 词表[i + 1];
    else if (词表[i] === "--模式") 参数.模式 = 词表[i + 1];
    else if (词表[i] === "--试名") 参数.试名 = 词表[i + 1];
    else if (词表[i] === "--候选行") 参数.候选行 = 词表[i + 1];
    else if (词表[i] === "--写试行") 参数.写试行 = 词表[i + 1];
    else if (词表[i] === "--已核实") 参数.已核实 = true;
  }
  if (!["clean_dh_k", "tick_completed"].includes(参数.脚本)) {
    console.error("用法：node scripts/调AirScript.cjs --脚本 clean_dh_k|tick_completed [--模式 probe|试|dry-run|写] [--试名 <名>] [--候选行 \"1319,2060\"] [--写试行 3000] [--已核实]");
    process.exitCode = 2;
    return;
  }
  if (!["probe", "试", "dry-run", "写"].includes(参数.模式)) {
    console.error(`未知模式：${参数.模式}（可用 probe|试|dry-run|写）`);
    process.exitCode = 2;
    return;
  }
  const 配置 = 读金山配置();
  const 条目 = (配置.scripts || {})[参数.脚本] || {};
  const webhookUrl = String(条目.webhookUrl || "").trim();
  if (!webhookUrl) {
    console.error(`\n  等黎路遥粘贴后补 webhook：把《脚本大全》对应行粘到目标表、生成同步 webhook，填进 30号 本机配置 scripts.${参数.脚本}.webhookUrl。\n`);
    process.exitCode = 2;
    return;
  }
  const 令牌 = 取令牌(配置);
  if (!令牌) {
    console.error("\n  缺少 AirScript-Token（本机配置或回退链里都没有）。\n");
    process.exitCode = 2;
    return;
  }
  const 候选行表 = 参数.候选行 ? String(参数.候选行).split(",").map((x) => Number(String(x).trim())).filter((n) => n > 0) : [];
  const argv = 参数.模式 === "probe" ? { probe: true }
    : 参数.模式 === "试" ? { 试: 参数.试名, ...(参数.写试行 ? { 写试行: Number(参数.写试行) } : {}) }
    : 参数.模式 === "dry-run" ? { dryRun: true, ...(候选行表.length ? { 候选行: 候选行表 } : {}), ...(参数.已核实 ? { 已核实: true } : {}) }
    : { allowWrite: true, ...(候选行表.length ? { 候选行: 候选行表 } : {}), ...(参数.已核实 ? { 已核实: true } : {}) };
  console.log(`  ${参数.脚本} | 模式 ${参数.模式}${参数.试名 ? "（" + 参数.试名 + "）" : ""}${候选行表.length ? " 候选行=" + 候选行表.join(",") : ""}${参数.已核实 ? " 已核实" : ""} → ${webhookUrl.slice(0, 78)}…`);
  const 响应 = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "AirScript-Token": 令牌 },
    body: JSON.stringify({ Context: { argv } }),
    signal: AbortSignal.timeout(180000)
  });
  const 文本 = await 响应.text();
  if (!响应.ok) throw new Error(`金山接口返回 HTTP ${响应.status}：${文本.slice(0, 300)}`);
  let 载荷 = null;
  try { 载荷 = JSON.parse(文本); } catch { throw new Error(`金山接口没有返回可解析的 JSON：${文本.slice(0, 300)}`); }
  if (载荷.error) throw new Error(`金山脚本报错：${String(载荷.error).slice(0, 300)}\n  原始响应：${文本.slice(0, 1200)}`);
  const 原始 = 载荷.data ? 载荷.data.result : 载荷.result;
  if (原始 === undefined || 原始 === null || 原始 === "[Undefined]") {
    throw new Error("金山脚本没有返回结果：确认脚本已保存，且最后一行是 return main()。");
  }
  const 结果 = typeof 原始 === "object" ? 原始 : JSON.parse(String(原始));
  const 落盘目录 = path.join(项目根, "runtime");
  fs.mkdirSync(落盘目录, { recursive: true });
  const 时间戳 = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const 落盘 = path.join(落盘目录, `调用-${参数.脚本}-${参数.模式}${参数.试名 ? "-" + 参数.试名 : ""}-${时间戳}.json`);
  fs.writeFileSync(落盘, JSON.stringify(结果, null, 2));
  console.log(JSON.stringify(结果, null, 2));
  console.log(`\n  落盘：${path.relative(仓库根, 落盘)}`);
}

main().catch((错) => {
  console.error(`\n  失败：${错.message}`);
  console.error("  失败不自动重试；先看现场再决定。\n");
  process.exitCode = 1;
});
