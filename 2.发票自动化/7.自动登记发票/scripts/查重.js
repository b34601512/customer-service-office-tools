// 7号 动作③：**写前查重** —— 云端全表按订单号查（只读）。命中 = 已登记过，绝不再写（重复登记=重复交税）。
// 用法：node scripts/查重.js --订单号 <单号> [--表 "科技--唐雪梅"] [--脚本 write_jituan]
const { 跑脚本 } = require("../src/金山脚本客户端");
const { 默认表名 } = require("../src/登记写入");

async function main() {
  const argv = process.argv.slice(2);
  let 表名 = 默认表名;
  let 脚本 = "write";
  let 订单号 = "";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--表") { 表名 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--脚本") { 脚本 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--订单号") { 订单号 = argv[i + 1]; i += 1; continue; }
  }
  if (!订单号) { console.error("用法：node scripts/查重.js --订单号 <单号> [--表 <子表名>]"); process.exit(2); }

  const 结果 = await 跑脚本({ orderNo: 订单号, checkOnly: true, sheets: [表名] }, { 脚本 });
  const 命中 = 结果 && 结果.duplicate === true;
  console.log(`\n  ③ 写前查重（只读）：订单号 ${订单号}　表 ${表名}`);
  console.log(`  结果：${命中 ? `已登记过（第 ${结果.row} 行）→ 禁止再写` : "未登记过 ✓ 可以写"}`);
  console.log(`  脚本版本：${结果 && 结果.scriptVersion}`);
  console.log("");
  if (命中) process.exitCode = 3;
}

main().catch((错误) => { console.error(`\n  查重失败：${错误.message}\n`); process.exit(1); });
