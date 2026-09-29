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
// 排班表里的名字 → 企微 userid（黎路遥 2026-09-29：工单负责人要按「此时此刻谁值班」来派；值班看**底色标记**）
const 值班人员表 = {
  邓远祥: { userId: 'woFqtuEQAAhOdmpaWCayvanGLTX9fatw', userName: '邓远祥（售后客服）' },
  柯紫婷: { userId: 'woFqtuEQAAm9VMBHM9Zqm3jl3W6U4y7Q', userName: '柯紫婷（售后客服）' },
  陈燕玲: { userId: 'woFqtuEQAAAavuSNo5VTWAf2TXPRLOWQ', userName: '陈燕玲（售后客服）' },
  缪婷婷: { userId: 'woFqtuEQAA25eR-eNXTC4bQoUip-VCiQ', userName: '缪婷婷（售后客服）' },
  李守耀: { userId: 'woFqtuEQAAcXT3pES1oR41I8G9-a8A0w', userName: '李守耀（售后组长）' },
};

/** 从排班表有色名单里挑一个售后（挑不到返回 null，绝不瞎猜） */
function 挑选值班负责人(names, map = 值班人员表) {
  for (const n of names || []) {
    for (const key of Object.keys(map)) if (String(n).includes(key)) return map[key];
  }
  return null;
}

const 排班读取工具 = 'D:/桌面/办公软件/20.经验大全/金山在线表格排班表读取/金山在线表格排班表读取.cjs';
const 排班配置 = 'D:/桌面/办公软件/22.后台售后服务单分析/project-config/wecom-notify.json';
const 排班输出目录 = 'D:/备份文件夹/排班-最新';
const 节点模块路径 = 'D:/桌面/办公软件/1.客服超时督办/node_modules';

/** 从 20号 排班表读取工具的 report 里取「当天有底色标记」的人（**底色才是值班标记**，不看班次文字） */
function 从report取有色姓名(report) {
  return (report && report['当日有色人员'] || []).map((x) => x['姓名']).filter(Boolean);
}

/**
 * 读「此刻售后谁值班」：调 20号 工具读金山排班表底色 → 取有色名单 → 交给 挑选值班负责人 过滤成售后。
 * 用户/经理 2026-09-29：「值班要看背景有标记颜色」，看 1号项目 issue #016。
 */
function 读此刻值班() {
  const fsx = require('fs');
  const cfg = JSON.parse(fsx.readFileSync(排班配置, 'utf8'));
  if (!cfg.scheduleUrl) throw new Error('排班配置里没有 scheduleUrl');
  execFileSync(process.execPath, [排班读取工具, '--url', cfg.scheduleUrl, '--date', new Date().toISOString().slice(0, 10), '--out', 排班输出目录], {
    encoding: 'utf8', maxBuffer: 40 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: 节点模块路径 },
  });
  const report = JSON.parse(fsx.readFileSync(排班输出目录 + '/schedule-report.json', 'utf8'));
  return 从report取有色姓名(report);
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
module.exports = { 解析参数, 构造记录, 挑选值班负责人, 从report取有色姓名, 值班人员表, DOCID, SHEET };
