// 7号 动作⑥：**验收对比**（只读）—— 拿写前/写后两份快照逐行逐列比：只有目标行按预期变化，其它行一字未变。
// 用法：node scripts/验收.js --订单号 <单号> --行 10497 --期望 <干跑证据.json>  [--写前 快照-…-写前.json] [--写后 快照-…-写后.json]
const path = require("path");
const fs = require("fs");
const { 对比快照 } = require("../src/写入验收");

const 项目根 = path.resolve(__dirname, "..");
const 证据目录 = path.join(项目根, "runtime");
const 读 = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(证据目录, p), "utf8"));

async function main() {
  const argv = process.argv.slice(2);
  let 订单号 = "";
  let 行 = 0;
  let 期望文件 = "";
  let 写前文件 = "";
  let 写后文件 = "";
  let 商品行数 = 1;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--订单号") { 订单号 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--行") { 行 = Number(argv[i + 1]); i += 1; continue; }
    if (argv[i] === "--期望") { 期望文件 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--写前") { 写前文件 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--写后") { 写后文件 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--商品行数") { 商品行数 = Number(argv[i + 1]); i += 1; continue; }
  }
  if (!订单号 || !行) { console.error("用法：node scripts/验收.js --订单号 <单号> --行 <行号> [--期望 干跑-<单号>.json] [--写前 …] [--写后 …]"); process.exit(2); }
  const 前 = 写前文件 || `快照-${订单号}-写前.json`;
  const 后 = 写后文件 || `快照-${订单号}-写后.json`;
  const 前快照 = 读(前).快照 || 读(前);
  const 后文件 = 读(后);
  const 后快照 = 后文件.快照 || 后文件;
  const 期望列 = {};
  if (期望文件 || fs.existsSync(path.join(证据目录, `干跑-${订单号}.json`))) {
    const 干 = 读(期望文件 || `干跑-${订单号}.json`);
    for (const [字母, 项] of Object.entries(干.列 || {})) 期望列[字母] = 项 && 项.值 !== undefined ? 项.值 : 项;
  }
  const 对比 = 对比快照(前快照, 后快照, 行, 期望列, 商品行数);
  console.log(`\n  ⑥ 验收对比：第 ${行} 行`);
  console.log(`  结果：${对比.通过 ? "✓ 通过（只有目标行按预期变化，其它行一字未动）" : "✗ 未通过"}`);
  for (const 问题 of 对比.问题) console.log(`    ✗ ${问题}`);
  console.log("");
  if (!对比.通过) process.exitCode = 1;
}

main().catch((错误) => { console.error(`\n  验收失败：${错误.message}\n`); process.exit(1); });
