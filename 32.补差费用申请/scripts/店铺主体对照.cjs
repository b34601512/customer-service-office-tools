#!/usr/bin/env node
// 32号 补差费用申请：《好评返现，返差价、运费汇总表【打印版】》子表「店铺-主体对照」的本地客户端。
//
// 数据通道：目标文档（打印版）里贴好的 AirScript「店铺主体对照」
//   （kdocs-scripts/AirScript-补差-店铺主体对照.md，AirScript 2.0 Beta）→ 本机存的同步 webhook。
// webhook / 令牌都不入库：project-config/kdocs-airscript.local.json（键 scripts.店铺主体对照.webhookUrl；
// 令牌回退链和 scripts/写入在线表.cjs 一样：本配置 apiToken → 7号 → 12号）。
// 失败不自动重试（用户铁律）；写动作必须回 written:true 且 回读差异数=0，否则判失败、退出码 1。
//
// 用法：
//   node scripts/店铺主体对照.cjs --模式 探针
//     → 只读：子表在不在、现有行数/表头、工作表清单（证据 runtime/证据/<时间戳>-店铺主体对照/1-探针.json）
//   node scripts/店铺主体对照.cjs --模式 刷对照 [--源 runtime/对照/店铺-主体-全量.json] [--预演]
//     → 本地构建 5 列行列表（42 条对照 + 20 个历史无主体店铺，共 62 行）并过守卫，再调 webhook 刷子表；
//       --预演 只构建+打印，不调 webhook（零写入）；证据 3-刷对照.json（--预演 为 0-预演.json）
//   node scripts/店铺主体对照.cjs --模式 读对照
//     → 只读：返回全表 5 列（给月度流程/和匿名读表互为备份）；证据 2-读对照.json
//
// 守卫（本地，不过就不发）：
//   ① 来源必须能构建出行列表；② 每行必须 5 列；③ 主体必须在白名单（或空串）；
//   ④ 是否进主体子表 只能以 是 / 否 开头；⑤ 是 只能配两个主体子表；⑥ 店铺名不重复。
// 备注：2026-10-08 冲突行（抖音02店）按「打印版现状」预置写在 行覆写，备注里带「待确认」；拍板后改这一行。
const fs = require("node:fs");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..");
const 默认源 = "runtime/对照/店铺-主体-全量.json";
const 配置路径 = path.join(项目根, "project-config", "kdocs-airscript.local.json");

// 主体白名单（2026-10-08 提取口径：存档对照表 + 明细里出现过的全部公司）
const 主体白名单 = [
  "深圳市德达医疗科技集团有限公司",
  "深圳市德达医疗器械有限公司",
  "深圳德达康健科技有限公司",
  "深圳德迩杰国际发展有限公司",
  "深圳市湘商企业发展有限公司"
];
// 目标表里有两个主体子表，只有这两个主体的行「是」进子表
const 进子表主体 = ["深圳市德达医疗科技集团有限公司", "深圳市德达医疗器械有限公司"];
// 存疑/未拍板店铺：备注统一加「待确认：」前缀
const 存疑店铺 = new Set(["抖音01店", "拼多多3店", "拼多多6店"]);
// 冲突行覆写（2026-10-08 提取回执唯一冲突：存档表归 德迩杰、历史补差单归器械）——
// **黎路遥 2026-10-08 17:03 拍板：冲突按存档表『店铺关系』为准、不看历史** → 抖音02店 = 德迩杰（无子表）。
const 行覆写 = {
  "抖音02店": {
    目标表店铺名: "抖音02店",
    主体: "深圳德迩杰国际发展有限公司",
    是否进主体子表: "否（无子表）",
    备注: "黎路遥 2026-10-08 口径：冲突以存档表「店铺关系」为准（不看历史）→ 德迩杰无子表，遇到停下问人。"
  }
};

function 清理(v) {
  return String(v === undefined || v === null ? "" : v).trim();
}

function 读配置() {
  if (!fs.existsSync(配置路径)) return {};
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

function 取Webhook(配置) {
  const 脚本 = (配置.scripts && 配置.scripts["店铺主体对照"]) || 配置["店铺主体对照"] || {};
  const 候选 = [
    脚本 && 脚本.webhookUrl,
    配置["店铺主体对照.webhookUrl"],
    typeof 配置["店铺主体对照"] === "string" ? 配置["店铺主体对照"] : ""
  ];
  for (const 值 of 候选) {
    const s = String(值 || "").trim();
    if (s) return s;
  }
  return "";
}

async function 调脚本(argv) {
  const 配置 = 读配置();
  const webhookUrl = 取Webhook(配置);
  if (!webhookUrl) {
    throw new Error("还没配 webhook：等黎路遥在打印版文档新建 AirScript 2.0 脚本「店铺主体对照」、粘 " +
      "kdocs-scripts/AirScript-补差-店铺主体对照.md、生成同步 webhook 后，填进 32号 project-config/kdocs-airscript.local.json 的 " +
      "scripts.店铺主体对照.webhookUrl。");
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

// 源 JSON → 5 列行列表（对照 42 条 + 历史无主体店铺 20 条）。
// 列：源表店铺名 | 目标表店铺名 | 主体 | 是否进主体子表 | 备注
function 构建行列表(源数据) {
  if (!源数据 || typeof 源数据 !== "object") throw new Error("源数据不是对象（先跑提取，默认 runtime/对照/店铺-主体-全量.json）");
  const 对照 = Array.isArray(源数据.对照) ? 源数据.对照 : [];
  if (!对照.length) throw new Error("源数据里没有「对照」数组：先跑 32号 提取（runtime/对照/店铺-主体-全量.json）");
  const 行列表 = [];
  for (const r of 对照) {
    const 源 = 清理(r.源表店铺名);
    if (!源) throw new Error("对照里有空店铺名，不猜——请人工检查源数据");
    const 目标 = 清理(r["目标表店铺名(规范化后)"] || r.目标表店铺名 || 源);
    const 主体 = 清理(r.主体);
    if (主体 && !主体白名单.includes(主体)) {
      throw new Error(`店铺「${源}」的主体「${主体}」不在白名单（出现新主体就走人工 review，别猜）`);
    }
    const 覆盖 = 行覆写[源];
    if (覆盖) {
      行列表.push([源, 覆盖.目标表店铺名, 覆盖.主体, 覆盖.是否进主体子表, 覆盖.备注]);
      continue;
    }
    const 进 = r.是否进主体子表 === true ? "是" : (主体 ? "否（无子表）" : "否（无主体）");
    let 备注 = 清理(r.备注);
    if (存疑店铺.has(源)) 备注 = "待确认：" + 备注;
    行列表.push([源, 目标, 主体, 进, 备注]);
  }
  const 历史 = Array.isArray(源数据.历史无主体店铺) ? 源数据.历史无主体店铺 : [];
  for (const h of 历史) {
    const 店 = 清理(h.店铺);
    if (!店) continue;
    行列表.push([店, 店, "", "否（无主体）",
      `历史店铺：无主体记录（${h.行数} 行，${h.行号}）；后续再出现需人工确认`]);
  }
  return 行列表;
}

// 本地守卫：每行 5 列、主体白名单、是否进主体子表 是/否、是 只能配两个子表主体、店铺名不重复。
// 通过返回规整后的行列表；不过抛错（一个字节都不发）。
function 校验行列表(行列表) {
  if (!Array.isArray(行列表) || !行列表.length) throw new Error("行列表为空");
  if (行列表.length > 800) throw new Error(`行列表 ${行列表.length} 行，超过硬上限 800（防手滑）`);
  const 看过 = new Set();
  const 出 = [];
  for (let i = 0; i < 行列表.length; i += 1) {
    const 行 = 行列表[i];
    const 号 = i + 1;
    if (!Array.isArray(行) || 行.length !== 5) {
      throw new Error(`第 ${号} 行不是 5 列（实际 ${Array.isArray(行) ? 行.length + " 列" : "非数组"}）`);
    }
    const [源, 目标, 主体, 进, 备注] = 行.map(清理);
    if (!源) throw new Error(`第 ${号} 行源表店铺名为空`);
    if (!目标) throw new Error(`第 ${号} 行目标表店铺名为空（没有改名规则就写源表名）`);
    if (主体 && !主体白名单.includes(主体)) throw new Error(`第 ${号} 行主体「${主体}」不在白名单`);
    if (!(进 === "是" || 进.startsWith("否"))) throw new Error(`第 ${号} 行「是否进主体子表」只能 是/否，收到「${进}」`);
    看给子表(进, 主体, 号);
    if (看过.has(源)) throw new Error(`第 ${号} 行店铺「${源}」重复出现（对照要一店一行）`);
    看过.add(源);
    出.push([源, 目标, 主体, 进, 备注]);
  }
  return 出;
}

function 看给子表(进, 主体, 号) {
  if (进 === "是") {
    if (!进子表主体.includes(主体)) throw new Error(`第 ${号} 行写着「是」进子表，但主体「${主体}」不是两个子表主体之一，拒绝`);
  } else {
    if (进子表主体.includes(主体)) throw new Error(`第 ${号} 行主体「${主体}」属于两个子表之一，「是否进主体子表」却填了「${进}」，拒绝`);
  }
}

// 刷对照 请求载荷（行数组走 JSON 字符串：webhook 入站数组是宿主对象，字符串最稳）
function 造载荷(行列表) {
  return { action: "刷对照", 行列表: JSON.stringify(行列表), allowWrite: true };
}

// 刷对照 成功判定（反向断言用）：必须 written 是真布尔 true，且 回读差异数为 0。
// 只回 status:'已写入' 之类、没有 written:true 的，一律判失败。
function 校验结果(结果) {
  if (!结果 || 结果.written !== true) {
    throw new Error(`服务端没回 written:true（拒绝把 status 之类当成功）：${JSON.stringify(结果).slice(0, 300)}`);
  }
  if (Number(结果.回读差异数) !== 0) {
    throw new Error(`回读有 ${结果.回读差异数} 格不一致：${JSON.stringify(结果.差异样例 || []).slice(0, 400)}`);
  }
  return { 写入行数: Number(结果.写入行数) || 0, 新建: Boolean(结果.新建), 清理: 结果.清理 || "", 数据末行: Number(结果.数据末行) || 0 };
}

function 解析参数(argv) {
  const 参数 = { 模式: "探针", 源: "", 预演: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--模式") 参数.模式 = argv[i + 1];
    else if (argv[i] === "--源") 参数.源 = argv[i + 1];
    else if (argv[i] === "--预演") 参数.预演 = true;
  }
  return 参数;
}

function 落盘证据(目录, 名称, 数据) {
  fs.mkdirSync(目录, { recursive: true });
  const 文件 = path.join(目录, 名称 + ".json");
  fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), ...数据 }, null, 2), "utf8");
  return 文件;
}

function 统计概览(行列表) {
  const 是按主体 = {};
  let 否 = 0;
  for (const 行 of 行列表) {
    if (行[3] === "是") 是按主体[行[2]] = (是按主体[行[2]] || 0) + 1;
    else 否 += 1;
  }
  return { 总行数: 行列表.length, 进子表: 是按主体, 不进: 否 };
}

// 一个模式跑一遍；deps.调脚本 可注入（测试用）。返回 { 模式, 结果/行列表, 证据 }
async function 跑(参数, deps = {}) {
  const 调 = deps.调脚本 || 调脚本;
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = deps.证据目录 || path.join(项目根, "runtime", "证据", 时间戳 + "-店铺主体对照");

  if (参数.模式 === "探针") {
    const 结果 = await 调({ action: "探针" });
    落盘证据(证据目录, "1-探针", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    return { 模式: "探针", 结果, 证据: 证据目录 };
  }

  if (参数.模式 === "读对照") {
    const 结果 = await 调({ action: "读对照" });
    落盘证据(证据目录, "2-读对照", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    return { 模式: "读对照", 结果, 证据: 证据目录 };
  }

  if (参数.模式 === "刷对照") {
    const 源路径 = path.resolve(项目根, 参数.源 || 默认源);
    if (!fs.existsSync(源路径)) throw new Error(`源数据文件不存在：${源路径}（默认 ${默认源}）`);
    const 源数据 = JSON.parse(fs.readFileSync(源路径, "utf8"));
    const 行列表 = 校验行列表(构建行列表(源数据));
    const 概览 = 统计概览(行列表);
    const 相对源 = path.relative(项目根, 源路径);
    console.log(`\n  32号 店铺-主体对照：源文件 ${相对源}`);
    console.log(`  行数 ${概览.总行数}（进子表 ${Object.entries(概览.进子表).map(([k, v]) => `${k} ${v}`).join("；") || "无"}；不进 ${概览.不进}）`);
    if (参数.预演) {
      落盘证据(证据目录, "0-预演", { 源文件: 相对源, 概览, 行列表 });
      console.log("  预演：只构建+校验，没有调 webhook（零写入）。");
      console.log(JSON.stringify(行列表.slice(0, 5), null, 2).slice(0, 1500));
      return { 模式: "刷对照", 预演: true, 行列表, 概览, 证据: 证据目录 };
    }
    const 结果 = await 调(造载荷(行列表));
    落盘证据(证据目录, "3-刷对照", { 源文件: 相对源, 请求行数: 行列表.length, ...结果 });
    const 审 = 校验结果(结果);
    console.log(`  刷对照：写入 ${审.写入行数} 行${审.新建 ? "（新建了工作表）" : ""}${审.清理 ? "，清理 " + 审.清理 : ""}，回读差异 0`);
    return { 模式: "刷对照", 结果, 审, 行列表, 证据: 证据目录 };
  }

  throw new Error(`不认识的 --模式 ${参数.模式}（探针 | 刷对照 | 读对照）`);
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 出 = await 跑(参数);
  if (出.证据) console.log(`\n  证据：${path.relative(项目根, 出.证据)}`);
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 构建行列表, 校验行列表, 造载荷, 校验结果, 解析参数, 调脚本, 跑, 统计概览, 主体白名单, 进子表主体, 行覆写, 取Webhook };
