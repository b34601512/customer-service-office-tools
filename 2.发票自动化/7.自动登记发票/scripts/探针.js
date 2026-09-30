// 7号 动作①：**只读探针** —— 确认云端写入脚本已保存生效 + 拿到「下一个可写行」。不写任何数据。
// 用法：node scripts/探针.js [--表 "科技--唐雪梅"] [--脚本 write_jituan]
const path = require("path");
const { 跑脚本 } = require("../src/金山脚本客户端");
const { 探针, 默认表名 } = require("../src/登记写入");

async function main() {
  const argv = process.argv.slice(2);
  let 表名 = 默认表名;
  let 脚本 = "write";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--表") { 表名 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--脚本") { 脚本 = argv[i + 1]; i += 1; continue; }
  }
  const 结果 = await 探针({ 跑脚本: (a) => 跑脚本(a, { 脚本 }) }, 表名);
  console.log(`\n  ① 探针（只读）：scriptVersion=${结果.scriptVersion || "未知"} mode=${结果.mode || "未知"}`);
  console.log(`  表：${结果.sheet || 表名}`);
  console.log(`  最后数据行：${结果.lastDataRow}　下一个可写行：${结果.nextWriteRow}`);
  if (结果.message) console.log(`  说明：${结果.message}`);
  console.log("");
}

main().catch((错误) => { console.error(`\n  探针失败：${错误.message}\n`); process.exit(1); });
