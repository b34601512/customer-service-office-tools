// 7号 动作⑦：**云端脚本自检**（只读）—— 每次云端脚本被粘贴/保存后跑一次：写脚本探针 + 读脚本查询各跑一遍。
//   用途：抓住「粘坏/编译不过/版本没更新」这类问题（失败台账 2026-09-30：集团表两个脚本被粘坏，就是探针抓到的）。
// 用法：node scripts/云端自检.js [--表 "科技--唐雪梅"] [--写脚本 write_jituan] [--读脚本 query_jituan]
// 退出码：两个都通过 = 0；任一失败 = 1（失败就停手，别真写）。
const { 跑脚本 } = require("../src/金山脚本客户端");

function 解析参数(argv) {
  const 结果 = { 表名: "科技--唐雪梅", 写脚本: "write_jituan", 读脚本: "query_jituan" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--表") { 结果.表名 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--写脚本") { 结果.写脚本 = argv[i + 1]; i += 1; continue; }
    if (argv[i] === "--读脚本") { 结果.读脚本 = argv[i + 1]; i += 1; continue; }
  }
  return 结果;
}

async function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  let 通过 = 0;
  let 失败 = 0;
  console.log(`\n  ⑦ 云端脚本自检（只读）：表 ${参数.表名}\n`);

  try {
    const 写 = await 跑脚本({ sheets: [参数.表名], probe: true }, { 脚本: 参数.写脚本 });
    console.log(`  写脚本「${参数.写脚本}」：✓ 编译通过　版本 ${写.scriptVersion}　模式 ${写.mode}　最后数据行 ${写.lastDataRow}　下一个可写行 ${写.nextWriteRow}`);
    通过 += 1;
  } catch (错误) {
    console.log(`  写脚本「${参数.写脚本}」：✗ ${错误.message.split("←")[0].trim()}`);
    console.log(`    现场：${错误.message.slice(0, 200)}`);
    失败 += 1;
  }

  try {
    const 读 = await 跑脚本({ sheets: [参数.表名], row: 1, rowEnd: 2 }, { 脚本: 参数.读脚本 });
    console.log(`  读脚本「${参数.读脚本}」：✓ 编译通过　版本 ${读.scriptVersion}　模式 ${读.mode}　返回行数 ${(读.rows || []).length}`);
    通过 += 1;
  } catch (错误) {
    console.log(`  读脚本「${参数.读脚本}」：✗ ${错误.message.split("←")[0].trim()}`);
    console.log(`    现场：${错误.message.slice(0, 200)}`);
    失败 += 1;
  }

  console.log(`\n  结果：通过 ${通过} / 失败 ${失败}${失败 ? "　→ **停手**：先修脚本再动表" : "　→ 可以按验收清单继续"}`);
  console.log("");
  if (失败) process.exitCode = 1;
}

main().catch((错误) => { console.error(`\n  自检失败：${错误.message}\n`); process.exit(1); });
