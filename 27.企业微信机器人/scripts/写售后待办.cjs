#!/usr/bin/env node
/**
 * 写售后待办（企微智能表格「金牌组待办清单」→「售后待办清单」子表）
 * 用户 2026-09-29 明确：金牌组代表售后；售后的待办事项文档就是这张子表。
 *
 * 用法：
 *   node scripts/写售后待办.cjs --content "要售后做什么" [--owner <企微userid>] [--deadline "2026-09-30 00:00:00"] [--priority 一般] [--dry-run]
 * 说明：
 *   - 只做「新增一行」，不删不改；写完会回读确认（关键词=待办正文前 20 字）。
 *   - 负责人默认李守耀（售后组长）；优先级默认「一般」（选项 id 取自表格既有行）。
 */
const { execFileSync } = require('child_process');
const path = require('path');

const DOCID = 's3_AFMAdwb9AAYCNsCs6UyrGQ9qORKS0';
const SHEET = '售后待办清单';
const WECOM = 'C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js';
const 默认负责人 = { userId: 'woFqtuEQAAcXT3pES1oR41I8G9-a8A0w', userName: '李守耀（售后组长）' };
const 优先级选项 = { 一般: { id: 'oonpZv', text: '一般' } };
// 排班表里的名字 → 企微 userid（黎路遥 2026-09-29：工单负责人要按「此时此刻谁值班」来派）
const 值班人员表 = {
  柯紫婷: { userId: 'woFqtuEQAAm9VMBHM9Zqm3jl3W6U4y7Q', userName: '柯紫婷（售后客服）' },
  李守耀: { userId: 默认负责人.userId, userName: 默认负责人.userName },
};
const 排班工具 = 'D:/桌面/办公软件/22.后台售后服务单分析/src/tools/who-is-on-duty.js';

/** 从排班表返回的值班名单里挑一个我们认识的人（挑不到返回 null，绝不瞎猜） */
function 挑选值班负责人(names, map = 值班人员表) {
  for (const n of names || []) {
    for (const key of Object.keys(map)) if (String(n).includes(key)) return map[key];
  }
  return null;
}

/** 调 22号 工具读「此刻售后谁值班」 */
function 读此刻值班() {
  const out = execFileSync(process.execPath, [排班工具, '--json'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf('{'))).names || [];
}

function 解析参数(argv) {
  const out = { 优先级: '一般', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--content') out.content = argv[++i];
    else if (a === '--owner' && argv[i + 1] === 'auto') { out.ownerAuto = true; i += 1; }
    else if (a === '--owner') out.ownerId = argv[++i];
    else if (a === '--owner-name') out.ownerName = argv[++i];
    else if (a === '--deadline') out.deadline = argv[++i];
    else if (a === '--priority') out.优先级 = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
  }
  if (!out.content) throw new Error('缺少 --content');
  return out;
}

function 构造记录({ content, ownerId, ownerName, deadline, 优先级 }) {
  const 负责人 = ownerId
    ? [{ userId: ownerId, userName: ownerName || '售后' }]
    : [默认负责人];
  return {
    values: {
      优先级: [优先级选项[优先级] || 优先级选项['一般']],
      待办事项: [{ type: 'text', text: content }],
      截止时间: deadline || new Date(Date.now() + 86400000).toISOString().slice(0, 10) + ' 00:00:00',
      是否完成: false,
      负责人,
    },
  };
}

function 写({ content, ownerId, ownerName, ownerAuto, deadline, 优先级, dryRun }) {
  if (ownerAuto) {
    const 值班 = 挑选值班负责人(读此刻值班());
    if (!值班) throw new Error('排班表读不到认识的值班人，请显式传 --owner <userid>（不猜）');
    ownerId = 值班.userId;
    ownerName = 值班.userName;
  }
  const rec = 构造记录({ content, ownerId, ownerName, deadline, 优先级 });
  const args = ['smartsheet', 'records', 'add', '--docid', DOCID, '--sheet-title', SHEET, '--records', JSON.stringify([rec])];
  if (dryRun) return { dryRun: true, args, rec };
  const out = execFileSync(process.execPath, [WECOM, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const key = content.slice(0, 20);
  const back = execFileSync(process.execPath, [WECOM, 'smartsheet', 'records', 'list', '--docid', DOCID, '--sheet-title', SHEET, '--limit', '300'], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  const hit = back.includes(key);
  return { ok: true, 回读命中: hit, 关键词: key, 原始响应长度: out.length };
}

if (require.main === module) {
  try {
    const r = 写(解析参数(process.argv.slice(2)));
    console.log(JSON.stringify({ ...r, args: undefined, rec: r.rec }, null, 1).slice(0, 900));
    if (r.ok && !r.回读命中) process.exitCode = 3;
  } catch (e) {
    console.error('失败：' + e.message);
    process.exitCode = 2;
  }
}
module.exports = { 解析参数, 构造记录, 挑选值班负责人, 值班人员表, DOCID, SHEET };
