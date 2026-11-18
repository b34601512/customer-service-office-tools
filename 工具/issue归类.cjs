#!/usr/bin/env node
"use strict";
/**
 * issue 归类 —— 按标题关键词把 issue 归到负责岗位（只读，打印 + 可选打标签）
 *
 * 为什么有它：账号是共享的（都是 b34601512），翻 issues 看不出「谁的项目问题」。
 * 靠人记分类＝过几天就乱；所以归类规则写在这里，一条命令重跑。
 *
 * 用法：
 *   node 工具/issue归类.cjs                 # 只打印统计与未归类清单
 *   node 工具/issue归类.cjs --清单          # 打印每条归属
 *   node 工具/issue归类.cjs --打标签 --干跑   # 看会给哪些单打什么标签
 *   node 工具/issue归类.cjs --打标签         # 真打标签（幂等：已有同标签不重复）
 *
 * 规则顺序：先匹配先赢（上面的更具体）。改规则只改本文件，不要另写一份。
 */
const { execFileSync } = require("child_process");

const 仓库 = "b34601512/customer-service-office-tools";

// 先匹配先赢：越具体越靠上
const 规则 = [
  ["探域",       /探域|话术卡|意图|型号卡|SKU|Agent|兜底|首问|拦截|TUV|认证|质检话术|AI ?(答|回复|推荐)错|串答/],
  ["发票",       /发票|回传|诺诺|开票|冲红|缺字段|登记|抬头|税号/],
  ["22号后台",   /22号|后台售后|售后单|漏处理|退货|退款|确认收货|待商家/],
  ["9号客服数据", /9号|客服数据|报表|透视|趋势|目标完成率|同步于|图表/],
  ["电话漏接",   /电话漏接|呼损|话单|排队|漏接/],
  ["改单表补差", /改单表|补差|交接表|退回|未退回|H ?列/],
  ["私域小蟹",   /小蟹|私域/],
  ["店铺指标",   /店铺指标|数据罗盘|指标更新/],
  ["未成交原因", /未成交|原因分析/],
  ["客诉",       /客诉|投诉/],
  ["质检",       /质检|抽检/],
  ["情报",       /情报|竞品|舆情监控/],
  ["推广",       /推广|千川|直通车|投放/],
  ["设计",       /设计|主图|详情页图|作图/],
  ["SoftTalk",   /SoftTalk|话术精灵/],
  ["周报",       /周报/],
  ["培训测试",   /培训|测试题|考核/],
  ["公关",       /公关|对外声明/],
  ["企微监听",   /企微|发消息|私信|监听|路由票|危险操作|群发/],
  ["人事文档",   /规矩|通讯录|AGENTS|索引|文档遗留|删除线|作废/],
  ["派活排班",   /派活|排班|值班|工单|待办/],
  ["技术工具",   /工具|脚本|登录态|锁\.cjs|退出码|断言|报错|crash|超时/],
];

function 归类(题) {
  for (const [名, re] of 规则) if (re.test(题)) return 名;
  return "未归类";
}

function gh(参) {
  return execFileSync("gh", 参, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const 参数 = process.argv.slice(2);
const 要清单 = 参数.includes("--清单") || 参数.includes("--打标签");
const 干跑 = 参数.includes("--干跑");
const 真打 = 参数.includes("--打标签") && !干跑;

const 全部 = JSON.parse(gh(["issue", "list", "--repo", 仓库, "--state", "all", "--limit", "1000", "--json", "number,title,state,labels"]));
const 分 = new Map();
for (const i of 全部) {
  const k = 归类(i.title);
  if (!分.has(k)) 分.set(k, []);
  分.get(k).push(i);
}
const 排 = [...分.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`共 ${全部.length} 条（open ${全部.filter((i) => i.state === "OPEN").length}）`);
for (const [k, arr] of 排) {
  const 开 = arr.filter((i) => i.state === "OPEN").length;
  console.log(`  ${k.padEnd(10, "　")} ${String(arr.length).padStart(3)} 条（open ${开}）`);
}

if (要清单) {
  console.log("\n── 逐条 ──");
  for (const [k, arr] of 排) {
    console.log(`\n[${k}]`);
    for (const i of arr) console.log(`  #${i.number} ${i.state === "OPEN" ? "○" : "×"} ${i.title.slice(0, 60)}`);
  }
}

const 未归 = 分.get("未归类") || [];
if (未归.length) {
  console.log(`\n── 未归类 ${未归.length} 条（需要人工看一眼或补规则）──`);
  for (const i of 未归.slice(0, 40)) console.log(`  #${i.number} ${i.state === "OPEN" ? "○" : "×"} ${i.title.slice(0, 70)}`);
  if (未归.length > 40) console.log(`  …还有 ${未归.length - 40} 条`);
}

if (真打) {
  console.log("\n── 打标签 ──");
  for (const [k, arr] of 排) {
    if (k === "未归类") continue;
    // 标签不存在就建
    try { gh(["label", "create", k, "--repo", 仓库, "--color", "0e8a16", "--force"]); } catch { /* 已存在 */ }
    for (const i of arr) {
      const 已有 = (i.labels || []).map((l) => l.name);
      if (已有.includes(k)) continue;
      try { gh(["issue", "edit", String(i.number), "--repo", 仓库, "--add-label", k]); } catch (e) { console.log(`  ✗ #${i.number} ${e.message.slice(0, 60)}`); }
    }
    console.log(`  ✓ ${k}：${arr.length} 条`);
  }
}
