#!/usr/bin/env node
/**
 * 往《木婉清 · 工作记录》→「待确认」子表追加一行（老板在表里回填「您的回复」）。
 *
 * 用法：
 *   node 0.木婉清档案/写待确认.cjs --事项 "…" [--类别 拍板] [--要确认什么 "…"] [--建议 "…"] \
 *        [--证据 "…"] [--示例 "…"] [--dry-run]
 * 说明：
 *   - 走本机 AirScript v3（《脚本大全》第 28 行，配置 project-config/kdocs-airscript.json，不入库）。
 *   - 写动作必须 allowWrite=true（本机逐次授权）；先 dry-run 看预览，再实写。
 *   - 「您的回复」是老板的列，本脚本不写。
 *   - 写完回读打印该行，确认落在表里。
 */
const path = require("path");
const 客户端 = require(path.resolve(__dirname, "..", "20.经验库", "kdocs脚本大全", "金山脚本客户端.js"));
// 本表专属脚本的 webhook 在 0号档案自己的配置里（不入库）；20号客户端的默认配置只有它自己的脚本。
const 本机配置 = require(path.resolve(__dirname, "project-config", "kdocs-airscript.json"));
const 选项 = { 脚本: "mwc_confirm", 配置: 本机配置 };

function 解析参数(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") { out.dryRun = true; continue; }
    const 键 = a.replace(/^--/, "");
    const 映射 = {
      事项: "事项", 类别: "类别", 要确认什么: "要确认什么", 建议: "我的建议",
      证据: "现状证据", 示例: "示例", 来源: "来源", 序号: "序号",
    };
    if (映射[键]) { out[映射[键]] = argv[++i]; }
  }
  if (!out["事项"]) throw new Error("缺少 --事项");
  return out;
}

async function 取下一个序号() {
  const 读结果 = await 客户端.跑脚本({ mode: "read", sheet: "待确认" }, 选项);
  const 行们 = (读结果 && 读结果.rows) || [];
  let 最大 = 0;
  for (const r of 行们) {
    const n = Number(String(r["序号"] || "").trim());
    if (Number.isFinite(n) && n > 最大) 最大 = n;
  }
  return String(最大 + 1);
}

async function 主流程(argv) {
  const 参数 = 解析参数(argv);
  // 序号自己补一个：第一列空着会让 AirScript 的「找空行」把它们当空行，下一行会覆盖写（2026-10-18 实测）
  const 序号 = 参数["序号"] || (参数.dryRun ? "(自动)" : await 取下一个序号());
  const 行 = [
    序号,
    参数["类别"] || "拍板",
    参数["事项"],
    参数["要确认什么"] || 参数["事项"],
    参数["示例"] || "",
    参数["我的建议"] || "",
    参数["现状证据"] || "",
    "",            // 您的回复 —— 老板的列，绝不写
    "待回复",
  ];
  const 请求 = { mode: "write", sheet: "待确认", rows: [行], allowWrite: !参数.dryRun };
  // 注意：金山脚本解析参数时会剥掉一层数组（argv 只看 [0]），传对象即可，别再包一层数组。
  const 结果 = await 客户端.跑脚本(请求, 选项);
  // 空号防呆（2026-10-18 实况）：第一列「序号」空着时，脚本能写进去但表里看着像没编号；
  // 而 AirScript 的「找空行」看的是**第一列**——序号空着，下一行会被它当空行再写一遍（撞行）。
  // 所以先读表、算出下一个序号，把第一列补上再写。
  return { 参数, 行, 结果 };
}

if (require.main === module) {
  主流程(process.argv.slice(2))
    .then(({ 行, 结果 }) => {
      console.log("提交的行：", JSON.stringify(行, null, 1));
      console.log("结果：", JSON.stringify(结果, null, 1).slice(0, 1800));
      if (结果 && 结果.failed && 结果.failed.length) process.exitCode = 3;
    })
    .catch((e) => { console.error("失败：" + e.message); process.exitCode = 2; });
}

module.exports = { 解析参数, 主流程 };
