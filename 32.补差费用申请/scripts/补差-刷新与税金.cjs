#!/usr/bin/env node
// 32号 补差费用申请：「刷新与税金」客户端（拆分 v6 大脚本后的 ②）。
//
// 数据通道：目标文档里贴好的 AirScript「补差-刷新与税金」
//   （kdocs-scripts/AirScript-补差-刷新与税金.md，AirScript 2.0 Beta）→ 本机存的同步 webhook。
// webhook / 令牌都不入库：project-config/kdocs-airscript.local.json（键 scripts.刷新税金.webhookUrl；
// 令牌回退链和 scripts/写入在线表.cjs 一样：本配置 apiToken → 7号 → 12号）。
// 失败不自动重试（用户铁律）；两个主体子表都要刷新成功且无「问题」才算过。
//
// 用法：
//   node scripts/补差-刷新与税金.cjs --模式 探针
//     → 只读：两个主体子表的透视锚点/布局/税金收入现状（证据 …/1-探针.json）
//   node scripts/补差-刷新与税金.cjs --模式 刷新与税金
//     → 刷新两个主体子表的透视 + 重写 F/G 税金/收入公式（证据 …/5-刷新与税金.json）
const path = require("node:path");
const 公共 = require("./补差-airscript客户端.cjs");

const 键们 = ["刷新税金", "补差-刷新与税金", "刷新与税金"];
const 缺配置提示 = "还没配 webhook：等黎路遥在打印版文档新建 AirScript 2.0 脚本「补差-刷新与税金」、" +
  "粘 kdocs-scripts/AirScript-补差-刷新与税金.md、生成同步 webhook 后，填进 32号 project-config/kdocs-airscript.local.json 的 " +
  "scripts.刷新税金.webhookUrl。";

async function 调脚本(argv) {
  return 公共.调脚本(argv, { 键们, 缺配置提示 });
}

function 解析参数(argv) {
  const 参数 = { 模式: "探针" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--模式") 参数.模式 = argv[i + 1];
  }
  return 参数;
}

// 刷新与税金 成功判定（反向断言用）：必须回 集团/器械 两组结果、都没有「问题」、刷新方式不是失败。
// 只回 status:'已写入' 之类、没有两组结果的，一律判失败。
function 校验刷新结果(结果) {
  if (!结果 || !结果.集团 || !结果.器械) {
    throw new Error(`服务端没回 集团/器械 两组刷新结果（拒绝把 status 之类当成功）：${JSON.stringify(结果).slice(0, 300)}`);
  }
  for (const [名, 组] of [["集团", 结果.集团], ["器械", 结果.器械]]) {
    if (组.问题) throw new Error(`刷新与税金(${名})有问题：${JSON.stringify(组).slice(0, 500)}`);
    if (!组.刷新方式 || String(组.刷新方式).startsWith("失败")) {
      throw new Error(`刷新与税金(${名})刷新方式异常：${JSON.stringify(组).slice(0, 300)}`);
    }
  }
  return 结果;
}

// 一个模式跑一遍；deps.调脚本 / deps.证据目录 可注入（测试用）。
async function 跑(参数, deps = {}) {
  const 调 = deps.调脚本 || 调脚本;
  const 时间戳 = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const 证据目录 = deps.证据目录 || path.join(公共.项目根, "runtime", "证据", 时间戳 + "-刷新税金");

  if (参数.模式 === "探针") {
    const 结果 = await 调({ action: "探针" });
    公共.落盘证据(证据目录, "1-探针", 结果);
    console.log(JSON.stringify(结果, null, 2).slice(0, 8000));
    return { 模式: "探针", 结果, 证据: 证据目录 };
  }

  if (参数.模式 === "刷新与税金") {
    const 结果 = await 调({ action: "刷新与税金", allowWrite: true });
    公共.落盘证据(证据目录, "5-刷新与税金", 结果);
    校验刷新结果(结果);
    for (const [名, 组] of [["集团", 结果.集团], ["器械", 结果.器械]]) {
      console.log(`  · ${名}：透视刷新=${组.刷新方式}，数据区 ${组.数据起}~${组.数据止}，税金/收入写了 ${组.写公式行数} 行`);
    }
    console.log(`\n  刷新与税金完成。证据：${path.relative(公共.项目根, 证据目录)}`);
    return { 模式: "刷新与税金", 结果, 证据: 证据目录 };
  }

  throw new Error(`不认识的 --模式 ${参数.模式}（探针 | 刷新与税金）`);
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

module.exports = { 调脚本, 解析参数, 校验刷新结果, 跑 };
