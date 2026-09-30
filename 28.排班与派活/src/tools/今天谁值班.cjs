#!/usr/bin/env node
// 今天谁值班 —— 全公司唯一口径：读金山排班表「单元格底色」判值班（不看早/晚文字）。
//
// 用法：
//   node src/tools/今天谁值班.cjs                        # 今天·售后（人读）
//   node src/tools/今天谁值班.cjs --group 售前            # 换分组
//   node src/tools/今天谁值班.cjs --group 全部 --json     # 机器读（全部有配置的分组）
//   node src/tools/今天谁值班.cjs --date 2026-09-30 --json
//   node src/tools/今天谁值班.cjs --cached                # 用上次落盘的报告（不重新读表）
//
// 退出码：0 挑到；3 读不到 / 分不清（按口径：停下来问人，不许猜）；2 读表或配置出错。
const { 读排班, 读配置, 读已有报告, 今天 } = require("../lib/排班读取");
const { 从报告挑值班 } = require("../lib/值班");

function 解析参数(argv) {
  const 出 = { group: "售后", json: false, cached: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--group") 出.group = argv[++i];
    else if (a === "--date") 出.date = argv[++i];
    else if (a === "--json") 出.json = true;
    else if (a === "--cached") 出.cached = true;
  }
  return 出;
}

function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const 配置 = 读配置();
  const 日期 = 参数.date || 今天();
  const 报告 = 参数.cached ? 读已有报告(配置) : 读排班(日期, 配置);
  const 分组们 = 参数.group === "全部" ? Object.values(配置.颜色分组 || {}) : [参数.group];

  const 结果 = 分组们.map((组) => ({ 分组: 组, ...从报告挑值班(报告, 组, 配置) }));
  if (参数.json) {
    console.log(JSON.stringify({ 日期: 报告.日期 || 日期, 有色人员: (报告["当日有色人员"] || []).map((x) => x.姓名), 值班: 结果 }, null, 1));
  } else {
    for (const r of 结果) {
      if (r.found) console.log(`${报告.日期 || 日期} ${r.分组}值班：${r.userName}（${r.理由}）`);
      else console.log(`${报告.日期 || 日期} ${r.分组}值班：**没挑到** —— ${r.理由}`);
    }
    const 有色 = (报告["当日有色人员"] || []).map((x) => `${x.姓名}(${x.底色})`).join("、");
    console.log(`当日有色人员：${有色 || "无"}`);
  }
  if (!结果.some((r) => r.found)) process.exitCode = 3;
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error("失败：" + e.message);
    process.exitCode = 2;
  }
}
module.exports = { 解析参数 };
