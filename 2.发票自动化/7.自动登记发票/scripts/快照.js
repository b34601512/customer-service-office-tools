// 7号 动作④：**抓行快照**（只读）—— 写前抓一次、写后抓一次，给「验收.js」对比用。
// 用法：node scripts/快照.js --订单号 <单号> --表 "科技--唐雪梅" --脚本 query_jituan --行 10497 [--标签 写前]
const path = require("path");
const fs = require("fs");
const { 跑脚本 } = require("../src/金山脚本客户端");
const { 抓快照 } = require("../src/写入验收");

const 项目根 = path.resolve(__dirname, "..");
const 证据目录 = path.join(项目根, "runtime");

async function main() {
  const argv = process.argv.slice(2);
  let 表名 = "";
  let 脚本 = "query";
  let 订单号 = "";
  let 行 = 0;
  let 标签 = "写前";
  let 上下 = 2;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--表") { 表名 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--脚本") { 脚本 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--订单号") { 订单号 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--行") { 行 = Number(argv[i + 1]); i += 1; continue; }
    if (argv[i] === "--标签") { 标签 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--上下") { 上下 = Number(argv[i + 1]); i += 1; continue; }
  }
  if (!表名 || !订单号 || !行) { console.error('用法：node scripts/快照.js --订单号 <单号> --表 <子表名> --行 <行号> [--脚本 query_jituan] [--标签 写前]'); process.exit(2); }

  const 起 = Math.max(1, 行 - 上下);
  const 止 = 行 + 上下;
  const 快照 = await 抓快照((a) => 跑脚本(a, { 脚本 }), 表名, 起, 止);
  fs.mkdirSync(证据目录, { recursive: true });
  const 文件 = path.join(证据目录, `快照-${订单号}-${标签}.json`);
  fs.writeFileSync(文件, JSON.stringify({ 时间: new Date().toISOString(), 订单号, 表名, 起, 止, 快照 }, null, 2), "utf8");
  console.log(`\n  ④ 快照（只读，${标签}）：第 ${起}~${止} 行`);
  for (const [号, 值] of Object.entries(快照.行).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`    第 ${号} 行：J=${值.J || "(空)"}`);
  }
  console.log(`  证据：${path.relative(项目根, 文件)}`);
  console.log("");
}

main().catch((错误) => { console.error(`\n  快照失败：${错误.message}\n`); process.exit(1); });
