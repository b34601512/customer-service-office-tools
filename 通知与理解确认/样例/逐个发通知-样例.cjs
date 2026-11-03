#!/usr/bin/env node
// 样例（回归）：逐个发通知.cjs --干 必须
//   ① 对日志里「已发」的人打印 [跳过]（断点续发，不重复打扰）
//   ② 对没发过的人打印 [干跑]（不发真消息）
//   ③ 退出码 0
// 这是 2026-11-03 拼3 通知那次踩出来的两条行为，谁改坏了这里立刻红。
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const 根 = 'D:/桌面/木婉清';
const 工具 = path.join(根, '通知与理解确认', '逐个发通知.cjs');
const 配置 = path.join(根, '通知与理解确认', '2026-11-03-拼3活动', '收件人.json');

const 断言 = [];
function 必须(条件, 说明) {
  断言.push({ 条件, 说明 });
}

if (!fs.existsSync(工具)) { console.error(`✗ 工具不在：${工具}`); process.exit(1); }
if (!fs.existsSync(配置)) { console.error(`✗ 夹具不在：${配置}`); process.exit(1); }

const r = spawnSync(process.execPath, [工具, '--配置', 配置, '--干'], { encoding: 'utf8' });
const 输出 = (r.stdout || '') + (r.stderr || '');

必须(r.status === 0, `退出码应为 0，实际 ${r.status}`);
必须(/\[跳过\]/.test(输出), '已发的人应打印 [跳过]（断点续发）');
必须(/\[干跑\]/.test(输出), '没发过的人应打印 [干跑]（干跑不真发）');

let 失败 = 0;
for (const a of 断言) {
  if (!a.条件) { console.error(`✗ ${a.说明}`); 失败++; }
}
if (失败) { console.error(`✗ 样例未过（${失败}/${断言.length}）`); process.exit(1); }
console.log(`✓ 样例全过（${断言.length} 条断言）`);
