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
//   node scripts/写入在线表.cjs --模式 插图 --数据 runtime/收款码图/2026-10-08/dataURL.json
//     插图：给 C 列格补图上身（只改当前为 DISPIMG 公式的格；逐格回读；失败不重试）。
const fs = require("node:fs");
const path = require("node:path");

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
  if (!fs.existsSync(全路径)) throw new Error(`待写数据文件不存在：${全路径}（先跑 scripts/准备月度数据.cjs）`);
  return { 全路径, 数据: JSON.parse(fs.readFileSync(全路径, "utf8")) };
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
    const 图 = (Array.isArray(数据) ? 数据 : [])
      .filter((x) => x && x.dataURL)
      .map((x) => ({ 行: Number(x.行), dataURL: String(x.dataURL) }));
    if (!图.length) throw new Error("数据文件里没有 {行, dataURL}（先用 scripts/导出收款码图.cjs 导图）");
    console.log(`\n  插图：${图.length} 张，逐张调用（单张最大 ${Math.round(Math.max(...图.map((x) => x.dataURL.length)) / 1024)} KB，避免单次 body 过大）`);
    let 成功 = 0;
    for (const 一 of 图) {
      console.log(`  · 行 ${一.行}（dataURL ${Math.round(一.dataURL.length / 1024)} KB）…`);
      const 结果 = await 调脚本({
        action: "插图",
        图: JSON.stringify([一]),
        预期起: 一.行,
        预期止: 一.行,
        allowWrite: true
      });
      落盘证据(证据目录, `7-插图-${一.行}`, 结果);
      const 行条 = (结果.逐行 || [])[0] || {};
      if (结果.成功数 === 1 && 结果.回读不符数 === 0) {
        成功 += 1;
        console.log(`    成功；新公式：${String(行条.新公式 || "").slice(0, 90)}`);
      } else {
        console.log(`    未成功：${JSON.stringify({ 成功数: 结果.成功数, 插入失败数: 结果.插入失败数, 回读不符数: 结果.回读不符数, 跳过: 结果.跳过, 行条 }).slice(0, 500)}`);
      }
    }
    console.log(`\n  插图完成：成功 ${成功} / ${图.length}（逐张证据 7-插图-<行>.json；有失败则退出码 1）`);
    if (成功 !== 图.length) process.exitCode = 1;
  } else if (参数.模式 === "全流程") {
    await 全流程(参数, 证据目录);
  } else {
    throw new Error(`不认识的 --模式 ${参数.模式}（探针 | 预演 | 写汇总 | 写主体 | 刷新与税金 | 自检图片API | 插图 | 全流程）`);
  }
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 调脚本, 脚本键 };
