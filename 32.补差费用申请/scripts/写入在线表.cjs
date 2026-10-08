#!/usr/bin/env node
// 32号 补差费用申请：把「待写数据」写进《好评返现，返差价、运费汇总表【打印版】》。
//
// 数据通道：目标文档里贴好的 AirScript「补差-写入」（kdocs-scripts/AirScript-补差-写入.md，
// **AirScript 2.0 Beta**，因为刷新透视表只有 2.0 有 API）→ 本机存的同步 webhook。
// webhook / 令牌都不入库：project-config/kdocs-airscript.local.json（令牌链：本配置 → 7号 → 12号）。
// 失败不自动重试（用户铁律）；每一步回读差异都必须为 0，否则停手报人。
//
// ⚠ 行数组一律用 JSON 字符串传（2026-10-08.3）：webhook 入站数组是宿主对象（instanceof Array
//   为 false，v2 守卫误判成“没有行”）；字符串实测原样到达，服务器 JSON.parse 后得到原生数组。
//
// 用法：
//   node scripts/写入在线表.cjs --模式 探针                        # 只读：看表结构/透视/末行
//   node scripts/写入在线表.cjs --模式 预演 --数据 runtime/待写数据/2026-09.json
//   node scripts/写入在线表.cjs --模式 写汇总 --数据 …
//   node scripts/写入在线表.cjs --模式 写主体 --数据 …
//   node scripts/写入在线表.cjs --模式 刷新与税金
//   node scripts/写入在线表.cjs --模式 全流程 --数据 runtime/待写数据/2026-09.json
//     全流程 = 探针 → 预演（守卫：末行/表头）→ 写汇总 → 写主体 → 刷新与税金；
//     每一步的证据 JSON 落到 runtime/证据/<时间戳>/。
//   node scripts/写入在线表.cjs --模式 自检图片API                  # 只读：查本运行时有没有 InsertImage/GetActiveShapeImg（会在临时格 T2000 试插一张再清空）
//   node scripts/写入在线表.cjs --模式 插图 --数据 <dataURL.json> [--批次 runtime/待写数据/2026-09.json] [--每批 N]
//     插图（2026-10-08.7 批量版）：数据文件的 `行` 须是**目标表行**（导出收款码图.cjs --批次 产出）；
//     旧文件只有源行时，用 --批次 现场映射（scripts/批次映射.cjs），映射不到/重复/超域一律不写；
//     默认**整批一把**（例：7 张缩略图 ~100KB，远低于官方 2M 正文上限，一次请求也少撞限流）；
//     --每批 N 可按 N 张拆请求（0=整批一把）。任一批抛错（限流/HTTP 5xx）→ 证据留档、停手不重试。
//     证据：整批一把 → runtime/证据/<时间戳>/7-插图-批量.json；拆批 → 7-插图-批量-<序号>.json。
//   node scripts/写入在线表.cjs --模式 写公式 --数据 runtime/还原-3格.json
//     写公式：把 [{行, 新公式, 当前公式}] 逐格写回（当前公式精确一致才写；行域=既有数据行）；失败不重试。
const fs = require("node:fs");
const path = require("node:path");
const { 读批次文件 } = require("./批次映射.cjs");
const { 算批组 } = require("./缩略图规格.cjs");

const 项目根 = path.resolve(__dirname, "..");
const 脚本键 = "write_bucha";

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
    throw new Error(`还没配 webhook：等黎路遥在目标文档新建 AirScript 2.0 脚本「补差-写入」、` +
      `粘 kdocs-scripts/AirScript-补差-写入.md、生成同步 webhook 后，填进 32号 project-config/kdocs-airscript.local.json 的 scripts.${脚本键}.webhookUrl。`);
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
  const 参数 = { 模式: "探针", 数据: "", 批次: "", 每批: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--模式") 参数.模式 = argv[i + 1];
    else if (argv[i] === "--数据") 参数.数据 = argv[i + 1];
    else if (argv[i] === "--批次") 参数.批次 = argv[i + 1];
    else if (argv[i] === "--每批") 参数.每批 = argv[i + 1];
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
  if (!fs.existsSync(全路径)) throw new Error(`待写数据文件不存在：${全路径}（先跑 scripts/准备月度数据.cjs）`);
  return { 全路径, 数据: JSON.parse(fs.readFileSync(全路径, "utf8")) };
}

// 插图数据文件 → { 图:[{行(目标行), 源行, dataURL}], 预期起, 预期止, 预期末行, 批次说明 }
// 规则（2026-10-08.6，防「源行当目标行」事故重演）：
//   ① 条目带 目标行（或 行语义='目标行' 的 行）→ 直接当目标行；
//   ② 否则 行/源行 是源表行号 → 必须给 --批次，按批次记录映射（scripts/批次映射.cjs，不硬编码偏移）；
//   ③ 映射不到 / 与批次矛盾 / 目标行重复 / 超出批次域 → 抛错（一个字节都不写）。
function 规整插图文(数据, 批次) {
  const 数 = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));
  const 图 = [];
  const 看过 = new Set();
  for (const x of Array.isArray(数据) ? 数据 : []) {
    if (!x || !x.dataURL) continue;
    let 显式目标 = 数(x.目标行);
    if (!Number.isFinite(显式目标) && x.行语义 === "目标行") 显式目标 = 数(x.行);
    let 源行 = 数(x.源行);
    if (!Number.isFinite(源行) && !Number.isFinite(显式目标)) 源行 = 数(x.行);
    let 目标行 = 显式目标;
    if (!Number.isFinite(目标行)) {
      if (!批次) {
        throw new Error(`数据文件里第 ${图.length + 1} 条只有源表行号 ${x.行}，没给 --批次，拒绝猜目标行（10-08 写错行事故的根因）`);
      }
      目标行 = 批次.源行到目标.get(源行);
      if (!Number.isFinite(目标行)) throw new Error(`源表行号 ${源行} 不在批次明细（${批次.目标首行}~${批次.目标末行}）里，拒绝`);
    } else if (批次 && Number.isFinite(源行)) {
      const 应写 = 批次.源行到目标.get(源行);
      if (Number.isFinite(应写) && 应写 !== 目标行) {
        throw new Error(`源表行号 ${源行} 按批次应写目标行 ${应写}，数据文件却写 ${目标行}，对不上，拒绝`);
      }
    }
    if (看过.has(目标行)) throw new Error(`目标行 ${目标行} 在数据文件里重复出现，拒绝`);
    看过.add(目标行);
    图.push({ 行: 目标行, 源行: Number.isFinite(源行) ? 源行 : null, dataURL: String(x.dataURL) });
  }
  if (!图.length) throw new Error("数据文件里没有 {行, dataURL}（先用 scripts/导出收款码图.cjs 导图）");
  const 行们 = 图.map((x) => x.行);
  if (批次) {
    for (const 行 of 行们) {
      if (行 < 批次.目标首行 || 行 > 批次.目标末行) throw new Error(`目标行 ${行} 超出批次域 ${批次.目标首行}~${批次.目标末行}，拒绝`);
    }
  }
  return {
    图,
    预期起: 批次 ? 批次.目标首行 : Math.min(...行们),
    预期止: 批次 ? 批次.目标末行 : Math.max(...行们),
    预期末行: 批次 ? 批次.目标末行 : 0,
    批次说明: 批次 ? `批次目标行 ${批次.目标首行}~${批次.目标末行}（写前置末 ${批次.写前置末} + ${批次.行数} 行）` : ""
  };
}

// 批量插图（2026-10-08.7：由「逐张串行」改成「默认整批一把 + --每批 N 可拆」）——给 同步收款码图.cjs 也复用。
//   为什么：缩略图 5~25KB/张，整批 7 张 ~100KB，官方正文上限 2M；一次请求也少撞「高级服务限流」。
//   服务端 v6 的「插图」动作已支持数组（解析图列表 → 逐张 InsertImage、逐格回读、失败不重试），无需改服务端。
//   失败处理：某批抛错（限流/HTTP 5xx 等）→ 该批证据落盘 + 行结果记不合格，**停手不再发后续批**，也不重试。
// 返回 { 成功, 总数, 批次:[{序号,行们,请求数,成功数,插入失败数,回读不符数,跳过数,错误,证据}], 行结果:[{行,源行,合格,插入,插入报错,跳过原因,旧公式,新公式}], 全合格 }
async function 执行插图序列(图, 规, 证据目录, 选项 = {}) {
  const 每批 = Number(选项.每批 == null || 选项.每批 === "" ? 0 : 选项.每批);
  const 组 = 算批组(图.length, 每批);
  const 最大KB = Math.round(Math.max(0, ...图.map((x) => String(x.dataURL || "").length)) / 1024);
  console.log(`\n  插图：${图.length} 张，${组.length <= 1 ? "整批一把" : `分 ${组.length} 批（--每批 ${每批}）`}（单张最大 ${最大KB} KB）`);
  console.log(`  行域：预期起 ${规.预期起} / 预期止 ${规.预期止}${规.批次说明 ? "（" + 规.批次说明 + "）" : ""}；目标行 ${图.map((x) => x.行).join("/")}`);
  const 调 = 选项.调脚本 || 调脚本;
  const 批次 = [];
  const 行结果 = [];
  let 成功 = 0;
  let 游标 = 0;
  for (let i = 0; i < 组.length; i += 1) {
    const 本组 = 图.slice(游标, 游标 + 组[i]);
    游标 += 组[i];
    const 行们 = 本组.map((x) => x.行);
    console.log(`  · 第 ${i + 1}/${组.length} 批：${本组.length} 张（目标行 ${行们.join("/")}）…`);
    let 结果 = null;
    let 错误 = "";
    try {
      结果 = await 调({
        action: "插图",
        图: JSON.stringify(本组.map((x) => ({ 行: x.行, dataURL: x.dataURL }))),
        预期起: 规.预期起,
        预期止: 规.预期止,
        预期末行: 规.预期末行 || undefined,
        allowWrite: true
      });
    } catch (e) {
      错误 = String((e && e.message) || e).slice(0, 500);
    }
    const 单批名 = 组.length <= 1 ? "7-插图-批量" : `7-插图-批量-${i + 1}`;
    落盘证据(证据目录, 单批名, 错误 ? { 批次: i + 1, 张数: 本组.length, 行: 行们, 错误 } : { 批次: i + 1, 张数: 本组.length, 行: 行们, ...结果 });
    if (错误) {
      批次.push({ 序号: i + 1, 行们, 请求数: 本组.length, 成功数: 0, 插入失败数: 本组.length, 回读不符数: 0, 跳过数: 0, 错误, 证据: 单批名 + ".json" });
      for (const 项 of 本组) 行结果.push({ 行: 项.行, 源行: 项.源行, 合格: false, 插入: "", 插入报错: 错误, 跳过原因: "", 旧公式: "", 新公式: "" });
      for (const 项 of 图.slice(游标)) 行结果.push({ 行: 项.行, 源行: 项.源行, 合格: false, 插入: "", 插入报错: "上一批失败后停手，未发起", 跳过原因: "", 旧公式: "", 新公式: "" });
      console.log(`    ✗ 整批失败：${错误}`);
      if (游标 < 图.length) console.log(`    → 按铁律停手（不重试、不发后续批）`);
      break;
    }
    const 逐行映射 = new Map((结果.逐行 || []).map((x) => [Number(x.行), x]));
    const 跳过映射 = new Map((结果.跳过 || []).map((x) => [Number(x.行), x]));
    let 本批成功 = 0;
    for (const 项 of 本组) {
      const 行条 = 逐行映射.get(项.行) || {};
      const 跳 = 跳过映射.get(项.行);
      const 合格 = Boolean(行条.插入) && !跳;
      if (合格) 本批成功 += 1;
      行结果.push({ 行: 项.行, 源行: 项.源行, 合格, 插入: 行条.插入 || "", 插入报错: 行条.插入报错 || "", 跳过原因: 跳 ? 跳.跳过原因 : "", 旧公式: 行条.旧公式 || "", 新公式: 行条.新公式 || "" });
    }
    成功 += 本批成功;
    批次.push({
      序号: i + 1, 行们, 请求数: 结果.请求数, 成功数: 结果.成功数,
      插入失败数: 结果.插入失败数, 回读不符数: 结果.回读不符数,
      跳过数: (结果.跳过 || []).length, 错误: "", 证据: 单批名 + ".json"
    });
    console.log(`    成功 ${本批成功}/${本组.length}${结果.回读不符数 ? `，回读不符 ${结果.回读不符数}` : ""}${(结果.跳过 || []).length ? `，跳过 ${(结果.跳过 || []).length}` : ""}`);
  }
  console.log(`\n  插图完成：成功 ${成功} / ${图.length}（证据 ${批次.map((b) => b.证据).join("、")}；有失败则退出码 1）`);
  return { 成功, 总数: 图.length, 批次, 行结果, 全合格: 成功 === 图.length };
}

async function 全流程(参数, 证据目录) {
  const { 全路径, 数据 } = 读数据文件(参数.数据);
  console.log(`\n  32号 写入全流程：${数据.月份}（申请日期 ${数据.申请日期}），数据文件 ${path.relative(项目根, 全路径)}`);
  const 预期 = 数据.预期末行 || {};
  if (!预期.汇总 || !预期.集团 || !预期.器械) throw new Error("数据文件里没有 预期末行（重跑 准备月度数据.cjs --预期汇总末行/--预期集团末行/--预期器械末行）");

  const 探 = await 调脚本({ action: "探针" });
  落盘证据(证据目录, "1-探针", 探);
  console.log(`  · 探针：汇总末行 ${探.汇总 && 探.汇总.末行}；集团数据末行 ${探.集团 && 探.集团.数据末行}；器械数据末行 ${探.器械 && 探.器械.数据末行}`);
  for (const 名 of ["集团", "器械"]) {
    const t = 探[名] && 探[名].透视;
    console.log(`    ${名} 透视：${t ? (t.名称 || "(未命名)") + " 源=" + (t.源 || "?") + " 位置=" + (t.位置 || "?") : "没找到！"}`);
  }

  const 预 = await 调脚本({
    action: "预演",
    汇总预期末行: 预期.汇总, 集团预期末行: 预期.集团, 器械预期末行: 预期.器械
  });
  落盘证据(证据目录, "2-预演", 预);
  const 通过 = 预.汇总 && 预.汇总.通过 && 预.集团 && 预.集团.通过 && 预.器械 && 预.器械.通过;
  const 表头全好 = [预.汇总, 预.集团, 预.器械].every((x) => x && !x.表头差异.length);
  console.log(`  · 预演：末行检查 ${通过 ? "通过" : "不通过"}，表头检查 ${表头全好 ? "通过" : "不通过"}`);
  if (!通过 || !表头全好) throw new Error(`预演不通过，停手：${JSON.stringify(预).slice(0, 800)}`);

  const 汇 = await 调脚本({ action: "写汇总", 汇总行: JSON.stringify(数据.汇总行), 预期末行: 预期.汇总, allowWrite: true });
  落盘证据(证据目录, "3-写汇总", 汇);
  if (!汇.written) throw new Error(`写汇总失败：${JSON.stringify(汇).slice(0, 500)}`);
  if (汇.回读差异数) throw new Error(`写汇总回读有 ${汇.回读差异数} 格不一致：${JSON.stringify(汇.差异样例).slice(0, 400)}`);
  console.log(`  · 写汇总：写 ${汇.写入行数} 行（第 ${汇.首行}~${汇.末行} 行），回读 0 差异`);

  const 主 = await 调脚本({
    action: "写主体",
    集团行: JSON.stringify(数据.主体["深圳市德达医疗科技集团有限公司"].行),
    器械行: JSON.stringify(数据.主体["深圳市德达医疗器械有限公司"].行),
    预期: { 集团: 预期.集团, 器械: 预期.器械 },
    allowWrite: true
  });
  落盘证据(证据目录, "4-写主体", 主);
  for (const [名, 组] of [["集团", 主.集团], ["器械", 主.器械]]) {
    if (!组 || !组.written) throw new Error(`写主体(${名})失败：${JSON.stringify(组).slice(0, 500)}`);
    if (组.回读差异数) throw new Error(`写主体(${名})回读有 ${组.回读差异数} 格不一致：${JSON.stringify(组.差异样例).slice(0, 400)}`);
    console.log(`  · 写主体(${名})：写 ${组.写入行数} 行，清掉第 4~${组.清除到} 行旧内容，回读 0 差异`);
  }

  const 财 = await 调脚本({ action: "刷新与税金", allowWrite: true });
  落盘证据(证据目录, "5-刷新与税金", 财);
  for (const [名, 组] of [["集团", 财.集团], ["器械", 财.器械]]) {
    if (!组 || 组.问题) throw new Error(`刷新与税金(${名})有问题：${JSON.stringify(组).slice(0, 500)}`);
    console.log(`  · ${名}：透视刷新=${组.刷新方式}，数据区 ${组.数据起}~${组.数据止}，税金/收入写了 ${组.写公式行数} 行`);
  }

  console.log(`\n  全流程完成。证据：${path.relative(项目根, 证据目录)}`);
  console.log("  下一步（验收）：用只读读表工具回读 汇总/两个主体子表，对行数、合计、透视、税金。\n");
  return { 探, 预, 汇, 主, 财 };
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = path.join(项目根, "runtime", "证据", 时间戳);

  if (参数.模式 === "探针") {
    const 结果 = await 调脚本({ action: "探针" });
    落盘证据(证据目录, "1-探针", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
  } else if (参数.模式 === "预演") {
    const { 数据 } = 读数据文件(参数.数据);
    const 预期 = 数据.预期末行 || {};
    const 结果 = await 调脚本({ action: "预演", 汇总预期末行: 预期.汇总 || 0, 集团预期末行: 预期.集团 || 0, 器械预期末行: 预期.器械 || 0 });
    落盘证据(证据目录, "2-预演", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
  } else if (参数.模式 === "写汇总" || 参数.模式 === "写主体") {
    const { 数据 } = 读数据文件(参数.数据);
    const 预期 = 数据.预期末行 || {};
    if (参数.模式 === "写汇总") {
      const 结果 = await 调脚本({ action: "写汇总", 汇总行: JSON.stringify(数据.汇总行), 预期末行: 预期.汇总, allowWrite: true });
      落盘证据(证据目录, "3-写汇总", 结果);
      console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    } else {
      const 结果 = await 调脚本({
        action: "写主体",
        集团行: JSON.stringify(数据.主体["深圳市德达医疗科技集团有限公司"].行),
        器械行: JSON.stringify(数据.主体["深圳市德达医疗器械有限公司"].行),
        预期: { 集团: 预期.集团, 器械: 预期.器械 },
        allowWrite: true
      });
      落盘证据(证据目录, "4-写主体", 结果);
      console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    }
  } else if (参数.模式 === "刷新与税金") {
    const 结果 = await 调脚本({ action: "刷新与税金", allowWrite: true });
    落盘证据(证据目录, "5-刷新与税金", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
  } else if (参数.模式 === "自检图片API") {
    const 结果 = await 调脚本({ action: "自检图片API" });
    落盘证据(证据目录, "6-自检图片API", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
  } else if (参数.模式 === "插图") {
    const { 数据 } = 读数据文件(参数.数据);
    const 批次 = 参数.批次 ? 读批次文件(path.resolve(项目根, 参数.批次)) : null;
    const 规 = 规整插图文(数据, 批次);
    const 序 = await 执行插图序列(规.图, 规, 证据目录, { 每批: 参数.每批 });
    if (序.成功 !== 序.总数) process.exitCode = 1;
  } else if (参数.模式 === "写公式") {
    const { 全路径, 数据 } = 读数据文件(参数.数据);
    const 列表 = (Array.isArray(数据) ? 数据 : []).map((x) => ({
      行: Number(x && x.行),
      新公式: String((x && x.新公式) || ""),
      当前公式: String((x && x.当前公式) || "")
    })).filter((x) => Number.isFinite(x.行) && x.新公式);
    if (!列表.length) throw new Error("数据文件里没有 {行, 新公式, 当前公式}（如 runtime/还原-3格.json）");
    console.log(`\n  写公式：${列表.length} 格（行 ${列表.map((x) => x.行).join("/")}）；当前公式精确一致才写，逐格回读，失败不重试`);
    const 结果 = await 调脚本({ action: "写公式", 公式行: JSON.stringify(列表), allowWrite: true });
    落盘证据(证据目录, "8-写公式", { 数据文件: path.relative(项目根, 全路径), ...结果 });
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    if (!结果.written || 结果.回读不符数 || 结果.写入失败数 || (结果.跳过 || []).length) process.exitCode = 1;
  } else if (参数.模式 === "全流程") {
    await 全流程(参数, 证据目录);
  } else {
    throw new Error(`不认识的 --模式 ${参数.模式}（探针 | 预演 | 写汇总 | 写主体 | 刷新与税金 | 自检图片API | 插图 | 写公式 | 全流程）`);
  }
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 调脚本, 脚本键, 规整插图文, 解析参数, 执行插图序列, 落盘证据, 读数据文件 };
