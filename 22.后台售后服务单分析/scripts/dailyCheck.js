#!/usr/bin/env node
// 每天跑一次的「该退未退」检查（一条命令跑完：扫表 → 筛 → 去重 → 出清单 → 可选发群）。
//
// 用法：
//   node scripts/dailyCheck.js                    # 只出清单（写文件 + 打印），不发任何消息
//   node scripts/dailyCheck.js --send             # 有发现时发企微群（@ 当天该值班的人）
//   node scripts/dailyCheck.js --days 7 --start-row 43000 --limit 3000
//
// 设计取舍：
//   · 默认 startRow=43000（表按登记日期升序，最近的记录在表尾）——只扫表尾约 3500 行，
//     足够覆盖“最近 7 天”，且不会像全表扫描那样一次返回上万行。
//   · **默认不发消息**；只有显式 --send 才发送（企微是真实发送，必须有人点头）。
const fs = require("fs");
const path = require("path");
const { runAirScript } = require("../src/engine/kdocsAirScript");
const { resolveDutyTargets } = require("../src/tools/who-is-on-duty");
const { selectPendingRefunds, buildNoticeText } = require("../src/features/refundCheck/refundCheckCore");
const { projectPath } = require("../src/config/stores");
const { log } = require("../src/engine/log");

function parseArgs(argv) {
  const args = { days: 7, startRow: 43000, limit: 3000, maxRows: 50000, at: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--days") { args.days = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--start-row") { args.startRow = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--limit") { args.limit = Number(argv[index + 1]); index += 1; continue; }
    if (token === "--at") { args.at = argv[index + 1]; index += 1; continue; }
    if (token === "--send") { args.send = true; }
  }
  return args;
}

async function sendNotice(text, atName, config) {
  const mobile = (config.members || {})[atName];
  if (!mobile) throw new Error(`配置里没有「${atName}」的手机号，无法 @ 他`);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > 2048) throw new Error(`消息 ${bytes} 字节，超过企微上限 2048，请拆条或精简`);
  const response = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text, mentioned_mobile_list: [mobile] } })
  });
  const result = await response.json();
  if (result.errcode !== 0) throw new Error(`企微返回 errcode=${result.errcode} errmsg=${result.errmsg}`);
  return { bytes, mobile };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stamp = new Date().toISOString().slice(0, 10);
  log("每日检查", "开始", `近 ${args.days} 天`, `扫第 ${args.startRow} 行起`);

  const raw = await runAirScript(
    { sheetName: "退货退款表", statusColumnIndex: 22, orderColumnIndex: 10, okStatusText: "已退款", startRow: args.startRow, maxRows: args.maxRows, limit: args.limit },
    { script: "filterPendingRefund" }
  );
  const result = selectPendingRefunds(raw.samples, { days: args.days });
  log("每日检查", "筛选完成", `样例 ${(raw.samples || []).length} 行`, `待处理 ${result.items.length} 单 / ${Math.round(result.totalAmount)} 元`);

  const outDir = projectPath("runtime", "kdocs", "每日检查");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), args, summary: raw.summary, skipped: result.skipped, items: result.items, totalAmount: result.totalAmount }, null, 2), "utf8");

  if (!result.items.length) {
    console.log(`\n  ${stamp}：近 ${args.days} 天没有「该退未退」的单（跳过 ${JSON.stringify(result.skipped)}）`);
    console.log(`  记录：${path.relative(projectPath(), outFile)}\n`);
    return;
  }

  console.log(`\n  ${stamp}：近 ${args.days} 天该退未退 ${result.items.length} 单 / ${Math.round(result.totalAmount)} 元`);
  for (const item of result.items) {
    console.log(`    ${item.date} ${item.platform} ${item.customer} ${item.orderId} 应退${Math.round(item.refund)}`);
  }

  const duty = await resolveDutyTargets({});
  const atName = args.at || duty.names[0] || "";
  console.log(`\n  通知对象：${duty.window} → ${duty.names.join("、") || "(无人值班)"}${args.at ? `（指定 ${args.at}）` : ""}`);
  const text = buildNoticeText(result, { atName });
  const textFile = projectPath("runtime", "kdocs", "每日检查", `${stamp}-待发消息.txt`);
  fs.writeFileSync(textFile, text, "utf8");
  console.log(`  消息草稿：${path.relative(projectPath(), textFile)}（${Buffer.byteLength(text, "utf8")} 字节）`);

  if (!args.send) {
    console.log(`\n  （本次不发送：加 --send 才会发企微群）\n`);
    return;
  }
  if (!atName) throw new Error("没有确定的通知对象（没人值班），已停止发送");
  const config = JSON.parse(fs.readFileSync(projectPath("project-config", "wecom-notify.json"), "utf8"));
  const sent = await sendNotice(text, atName, config);
  log("每日检查", "已发送", `@${atName}（${sent.mobile}）`, `${sent.bytes} 字节 errcode=0`);
  console.log(`\n  ✓ 已发企微群 @${atName}\n`);
}

main().catch((error) => {
  log("每日检查", "失败", error.message);
  console.error(`\n  失败：${error.message}\n`);
  process.exit(1);
});
