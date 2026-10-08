#!/usr/bin/env node
// 32号 补差费用申请：「写数据」客户端（拆分 v6 大脚本后的 ①）。
//
// 怀化工厂登记红线（黎路遥 2026-10-08 17:17）：主体子表 M~P 列是人工填写的「怀化工厂登记」，
//   本客户端/服务端写主体**只清 A4:L**（并不删行）、不碰 M~P；清空 M~P 只用 scripts/补差-清怀化登记.cjs（点名才跑）。
//
// 数据通道：目标文档里贴好的 AirScript「补差-写数据」
//   （kdocs-scripts/AirScript-补差-写数据.md，AirScript 2.0 Beta）→ 本机存的同步 webhook。
// webhook / 令牌都不入库：project-config/kdocs-airscript.local.json（键 scripts.写数据.webhookUrl；
// 令牌回退链和 scripts/写入在线表.cjs 一样：本配置 apiToken → 7号 → 12号）。
// 失败不自动重试（用户铁律）；写动作必须回 written:true 且 回读差异数=0，否则判失败、退出码 1。
//
// 日期列（v6→拆分新修，2026-10-08 黎路遥发现「申请日期未识别为日期」）：
//   汇总 A 购买日期 / N 申请日期、主体 H 处理时间，由服务端 `日期序()` 归一成**序列号**再写，
//   并显式设日期格式 yyyy/m/d；本客户端把数据文件里的日期串原样传过去即可（不需要自己转）。
//
// 用法：
//   node scripts/补差-写数据.cjs --模式 探针
//     → 只读：表结构/末行/透视锚（证据 runtime/证据/<时间戳>-写数据/1-探针.json）
//   node scripts/补差-写数据.cjs --模式 预演 --数据 runtime/待写数据/2026-09.json
//     → 只读：表头+末行守卫（三个表都要与数据文件里的 预期末行 一致）
//   node scripts/补差-写数据.cjs --模式 写数据 --数据 runtime/待写数据/2026-09.json
//     → 写汇总 → 写主体（一把跑完；任一步失败即停，不重试）
//       证据：3-写汇总.json、4-写主体.json
const path = require("node:path");
const fs = require("node:fs");
const 公共 = require("./补差-airscript客户端.cjs");

const 键们 = ["写数据", "补差-写数据"];
const 缺配置提示 = "还没配 webhook：等黎路遥在打印版文档新建 AirScript 2.0 脚本「补差-写数据」、" +
  "粘 kdocs-scripts/AirScript-补差-写数据.md、生成同步 webhook 后，填进 32号 project-config/kdocs-airscript.local.json 的 " +
  "scripts.写数据.webhookUrl。";

async function 调脚本(argv) {
  return 公共.调脚本(argv, { 键们, 缺配置提示 });
}

function 解析参数(argv) {
  const 参数 = { 模式: "探针", 数据: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--模式") 参数.模式 = argv[i + 1];
    else if (argv[i] === "--数据") 参数.数据 = argv[i + 1];
  }
  return 参数;
}

function 读数据文件(路径) {
  const 全路径 = path.resolve(公共.项目根, 路径 || "");
  if (!fs.existsSync(全路径)) throw new Error(`待写数据文件不存在：${全路径}（先跑 scripts/准备月度数据.cjs）`);
  const 数据 = JSON.parse(fs.readFileSync(全路径, "utf8"));
  const 预期 = 数据.预期末行 || {};
  if (!Number.isFinite(Number(预期.汇总)) || !Number.isFinite(Number(预期.集团)) || !Number.isFinite(Number(预期.器械))) {
    throw new Error("数据文件里没有 预期末行（重跑 准备月度数据.cjs --预期汇总末行/--预期集团末行/--预期器械末行）");
  }
  return { 全路径, 数据, 预期 };
}

// 服务端载荷（行数组走 JSON 字符串：webhook 入站数组是宿主对象，字符串最稳）
function 造预演载荷(数据) {
  const 预期 = 数据.预期末行 || {};
  return {
    action: "预演",
    汇总预期末行: Number(预期.汇总),
    集团预期末行: Number(预期.集团),
    器械预期末行: Number(预期.器械)
  };
}

function 造写汇总载荷(数据) {
  return { action: "写汇总", 汇总行: JSON.stringify(数据.汇总行), 预期末行: Number(数据.预期末行.汇总), allowWrite: true };
}

function 造写主体载荷(数据) {
  return {
    action: "写主体",
    集团行: JSON.stringify(数据.主体["深圳市德达医疗科技集团有限公司"].行),
    器械行: JSON.stringify(数据.主体["深圳市德达医疗器械有限公司"].行),
    预期: { 集团: Number(数据.预期末行.集团), 器械: Number(数据.预期末行.器械) },
    allowWrite: true
  };
}

// 一个模式跑一遍；deps.调脚本 / deps.证据目录 可注入（测试用）。
async function 跑(参数, deps = {}) {
  const 调 = deps.调脚本 || 调脚本;
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = deps.证据目录 || path.join(公共.项目根, "runtime", "证据", 时间戳 + "-写数据");
  const 落 = (名称, 数据) => 公共.落盘证据(证据目录, 名称, 数据);

  if (参数.模式 === "探针") {
    const 结果 = await 调({ action: "探针" });
    落("1-探针", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    return { 模式: "探针", 结果, 证据: 证据目录 };
  }

  const { 全路径, 数据 } = 读数据文件(参数.数据);
  const 相对 = path.relative(公共.项目根, 全路径);

  if (参数.模式 === "预演") {
    const 结果 = await 调(造预演载荷(数据));
    落("2-预演", 结果);
    const 过 = Boolean(结果.汇总 && 结果.汇总.通过 && 结果.集团 && 结果.集团.通过 && 结果.器械 && 结果.器械.通过);
    const 头好 = [结果.汇总, 结果.集团, 结果.器械].every((x) => x && !(x.表头差异 || []).length);
    console.log(`  预演：${数据.月份 || 相对} 末行检查 ${过 ? "通过" : "不通过"}，表头检查 ${头好 ? "通过" : "不通过"}`);
    if (!过 || !头好) throw new Error(`预演不通过，停手：${JSON.stringify(结果).slice(0, 800)}`);
    return { 模式: "预演", 结果, 数据, 全路径, 证据: 证据目录 };
  }

  if (参数.模式 === "写数据") {
    const 汇 = await 调(造写汇总载荷(数据));
    落("3-写汇总", 汇);
    公共.校验写结果(汇, "写汇总");
    console.log(`  · 写汇总：写 ${汇.写入行数} 行（第 ${汇.首行}~${汇.末行} 行），回读 0 差异`);

    const 主 = await 调(造写主体载荷(数据));
    落("4-写主体", 主);
    for (const [名, 组] of [["集团", 主.集团], ["器械", 主.器械]]) {
      公共.校验写结果(组, `写主体(${名})`);
      console.log(`  · 写主体(${名})：写 ${组.写入行数} 行，清掉第 4~${组.清除到} 行旧内容（只清 A~L，不碰 M~P 怀化登记），回读 0 差异`);
    }
    console.log(`\n  写数据完成（${数据.月份 || 相对}）。证据：${path.relative(公共.项目根, 证据目录)}`);
    return { 模式: "写数据", 数据, 全路径, 汇, 主, 证据: 证据目录 };
  }

  throw new Error(`不认识的 --模式 ${参数.模式}（探针 | 预演 | 写数据）`);
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 出 = await 跑(参数);
  if (出.证据 && 参数.模式 !== "探针") console.log(`  证据：${path.relative(公共.项目根, 出.证据)}`);
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 调脚本, 解析参数, 读数据文件, 造预演载荷, 造写汇总载荷, 造写主体载荷, 跑, 校验写结果: 公共.校验写结果, 落盘证据: 公共.落盘证据 };
