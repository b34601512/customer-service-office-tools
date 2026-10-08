#!/usr/bin/env node
// 32号 补差费用申请：「清怀化登记」客户端（怀化工厂登记 M~P 红线的唯一写入口）。
//
// 背景（黎路遥 2026-10-08 17:17 红线）：两个主体子表的 M~P 列 =「怀化工厂登记」，他人工填写；
//   日常「写数据」绝不碰 M~P（已改只清 A4:L）；本客户端**只在他点名时**才跑，且必须带确认文本。
// 数据通道：目标文档里贴好的 AirScript「补差-清怀化登记」
//   （kdocs-scripts/AirScript-补差-清怀化登记.md，AirScript 2.0 Beta）→ 本机存的同步 webhook。
// webhook / 令牌都不入库：project-config/kdocs-airscript.local.json（键 scripts.清怀化登记.webhookUrl；
// 令牌回退链和 scripts/补差-airscript客户端.cjs 一样：本配置 apiToken → 7号 → 12号）。
// 失败不自动重试（用户铁律）；写结果必须回 written:true + 列守卫通过 + 每表清空完成 + 带清前快照，
// 否则判失败、退出码 1。
//
// 用法：
//   node scripts/补差-清怀化登记.cjs --模式 探针
//     → 只读：两张主体表 M~P 现状（哪几行非空、内容摘要）；证据 …/1-探针.json
//   node scripts/补差-清怀化登记.cjs --模式 清空 --表 集团 --确认 "清空怀化工厂登记" [--行域 4:13]
//     → 清 M~P（缺省行域 = 数据区 4~数据末行）；**先把清前快照落盘并打印路径**（人看得见抹掉的是什么），
//       再校验回读结果；证据 …/2-清前快照.json、…/3-清怀化登记.json
//   node scripts/补差-清怀化登记.cjs --模式 清空 --表 全部 --确认 "清空怀化工厂登记" --预演
//     → **零请求**：只打印将要发的载荷并落证据 …/0-预演.json，不发任何 webhook
const path = require("node:path");
const 公共 = require("./补差-airscript客户端.cjs");

const 键们 = ["清怀化登记", "补差-清怀化登记"];
const 缺配置提示 = "还没配 webhook：等黎路遥在打印版文档新建 AirScript 2.0 脚本「补差-清怀化登记」、" +
  "粘 kdocs-scripts/AirScript-补差-清怀化登记.md、生成同步 webhook 后，填进 32号 project-config/kdocs-airscript.local.json 的 " +
  "scripts.清怀化登记.webhookUrl（别动别的键）。";
const 确认文本 = "清空怀化工厂登记";
const 合法表 = ["集团", "器械", "全部"];

async function 调脚本(argv) {
  return 公共.调脚本(argv, { 键们, 缺配置提示 });
}

function 解析参数(argv) {
  const 参数 = { 模式: "探针", 表: "全部", 行域: "", 确认: "", 预演: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--模式") 参数.模式 = argv[i + 1];
    else if (argv[i] === "--表") 参数.表 = argv[i + 1];
    else if (argv[i] === "--行域") 参数.行域 = argv[i + 1];
    else if (argv[i] === "--确认") 参数.确认 = argv[i + 1];
    else if (argv[i] === "--预演") 参数.预演 = true;
  }
  return 参数;
}

// 造写载荷：表名白名单 + 确认文本必须一字不差（客户端先拦一道，服务端还会再拦）
function 造清空载荷(参数) {
  if (!合法表.includes(参数.表)) {
    throw new Error(`--表 只认 ${合法表.join("/")}（收到 ${JSON.stringify(参数.表)}）`);
  }
  if (参数.确认 !== 确认文本) {
    throw new Error(`--确认 必须一字不差地写 "${确认文本}"（收到 ${JSON.stringify(参数.确认)}）`);
  }
  const 载荷 = { action: "清怀化登记", 表: 参数.表, 确认: 参数.确认, allowWrite: true };
  if (参数.行域) 载荷.行域 = String(参数.行域);
  return 载荷;
}

// 清空结果成功判定（反向断言用）：必须 written:true（真布尔）+ 列守卫通过 + 每表 written/清空完成
// 且带清前快照。只回 status:'已写入' 之类、没有 written:true 的，一律判失败。
function 校验清空结果(结果, 表 = "全部") {
  if (!结果 || 结果.written !== true) {
    throw new Error(`服务端没回 written:true（拒绝把 status 之类当成功）：${JSON.stringify(结果).slice(0, 300)}`);
  }
  if (!结果.列守卫 || 结果.列守卫.通过 !== true) {
    throw new Error(`列守卫没通过（只允许动 M~P，其它列一个都不许碰）：${JSON.stringify(结果.列守卫 || {}).slice(0, 300)}`);
  }
  const 要的名 = 表 === "全部" ? ["集团", "器械"] : [表];
  for (const 名 of 要的名) {
    const 组 = 结果[名];
    if (!组 || 组.written !== true) {
      throw new Error(`${名}没回 written:true 或没清成：${JSON.stringify(组 || {}).slice(0, 400)}`);
    }
    if (!组.清前快照 || !Array.isArray(组.清前快照.明细)) {
      throw new Error(`${名}没带清前快照（红线：清前必须先快照）：${JSON.stringify(组 || {}).slice(0, 300)}`);
    }
    if (组.清空完成 !== true) {
      throw new Error(`${名}清完回读还有非空格（没清干净）；剩余行：${JSON.stringify(组.清后剩余 || []).slice(0, 300)}`);
    }
  }
  return 结果;
}

// 一个模式跑一遍；deps.调脚本 / deps.证据目录 可注入（测试用）。
async function 跑(参数, deps = {}) {
  const 调 = deps.调脚本 || 调脚本;
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = deps.证据目录 || path.join(公共.项目根, "runtime", "证据", 时间戳 + "-清怀化登记");
  const 落 = (名称, 数据) => 公共.落盘证据(证据目录, 名称, 数据);
  const 打路径 = (名称) => path.relative(公共.项目根, path.join(证据目录, 名称 + ".json"));

  if (参数.预演) {
    const 载荷 = 参数.模式 === "清空" ? 造清空载荷(参数) : { action: "探针" };
    落("0-预演", { 模式: 参数.模式, 载荷 });
    console.log(`  --预演（零请求）：将要发 ${JSON.stringify(载荷)}`);
    console.log(`  证据：${打路径("0-预演")}`);
    return { 模式: 参数.模式, 预演: true, 载荷, 证据: 证据目录 };
  }

  if (参数.模式 === "探针") {
    const 结果 = await 调({ action: "探针" });
    落("1-探针", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    return { 模式: "探针", 结果, 证据: 证据目录 };
  }

  if (参数.模式 === "清空") {
    const 载荷 = 造清空载荷(参数);
    const 结果 = await 调(载荷);
    // 先把清前快照落盘并打印路径（人看得见抹掉的是什么），再校验/报回读结果
    const 快照 = {};
    for (const 名 of ["集团", "器械"]) {
      if (结果 && 结果[名] && 结果[名].清前快照) 快照[名] = 结果[名].清前快照;
    }
    落("2-清前快照", { 表: 参数.表, 载荷, 快照 });
    console.log(`  清前快照（抹掉的是什么）：${打路径("2-清前快照")}`);
    落("3-清怀化登记", 结果);
    校验清空结果(结果, 参数.表);
    for (const [名, 组] of [["集团", 结果.集团], ["器械", 结果.器械]]) {
      if (!组) continue;
      const 回 = 组.清后回读 || {};
      console.log(`  · ${名}：清 ${组.清范围} 共 ${回.总格数} 格（原有 ${组.清前快照.非空格数} 格非空），回读后 ${回.清后非空格数} 格非空`);
      if (组.清前快照.明细截断) console.log(`  ⚠ ${名}：快照明细超 200 行已截断，恢复前先看 2-清前快照.json`);
    }
    console.log(`\n  清怀化登记完成。证据：${path.relative(公共.项目根, 证据目录)}`);
    return { 模式: "清空", 载荷, 结果, 快照, 证据: 证据目录 };
  }

  throw new Error(`不认识的 --模式 ${参数.模式}（探针 | 清空）`);
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 出 = await 跑(参数);
  if (出.证据) console.log(`  证据：${path.relative(公共.项目根, 出.证据)}`);
}

if (require.main === module) {
  main().catch((错误) => {
    console.error(`\n  失败：${错误.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { 调脚本, 解析参数, 造清空载荷, 校验清空结果, 跑, 确认文本, 合法表, 键们 };
