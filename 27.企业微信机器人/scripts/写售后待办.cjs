#!/usr/bin/env node
/**
 * 写售后待办（企微智能表格「金牌组待办清单」→「售后待办清单」子表）
 * 用户 2026-09-29 明确：金牌组代表售后；售后的待办事项文档就是这张子表。
 *
 * 用法：
 *   node scripts/写售后待办.cjs --content "要售后做什么" [--owner <企微userid>] [--deadline "2026-09-30 00:00:00"] [--priority 一般] [--dry-run]
 * 说明：
 *   - 只做「新增一行」，不删不改；写完会回读确认（关键词=待办正文前 20 字）。
 *   - 负责人默认李某某（售后组长）；优先级默认「一般」（选项 id 取自表格既有行）。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 值班/排班**口径统一在 28号 项目**（用户 2026-09-30：「专门讲安排工作、看排班表…统一迁移到这里来」）：
// 本条只负责“照着 28号 的结论派人”，不再自己维护值班名单/排班表链接。
const 值班库 = require('../../28.排班与派活/src/lib/值班');
const 排班库 = require('../../28.排班与派活/src/lib/排班读取');

// 表 docid = **公司私有数据，不进仓库**（仓库是公开的）：从本机配置读，环境变量优先。
// 本机配置：27.企业微信机器人/project-config/售后待办.local.json → {"docid":"s3_…","sheet":"售后待办清单"}
const 本机配置路径 = path.join(__dirname, '..', 'project-config', '售后待办.local.json');
function 读表配置(env, 配置路径) {
  const e = env || process.env;
  if (e.WECOM_售后待办DOCID) return { docid: e.WECOM_售后待办DOCID, sheet: e.WECOM_售后待办SHEET || '售后待办清单' };
  const p = 配置路径 || 本机配置路径;
  if (!fs.existsSync(p)) {
    throw new Error(`没读到售后待办表的 docid（公司私有数据，不进仓库）：请在本机建 ${p}，写 {"docid":"s3_…"}`);
  }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!j.docid) throw new Error(p + ' 里没有 docid');
  return { docid: j.docid, sheet: j.sheet || '售后待办清单' };
}
const DOCID = (() => { try { return 读表配置().docid; } catch (e) { return null; } })();
const SHEET = '售后待办清单';
const WECOM = 'C:/Users/b3460/AppData/Roaming/npm/node_modules/@wecom/cli/bin/wecom.js';
const 默认负责人 = { userId: 'wo******************************', userName: '李某某（售后组长）' };
const 优先级选项 = { 一般: { id: 'oonpZv', text: '一般' } };

/**
 * 兼容旧名：从「当日有色人员」里挑售后值班（口径与名单在 28号）。
 * **不猜**：没带底色 / 同分组多人带底色 / **带底色但此刻不在其班次时段** / 配置里没 userid ⇒ 返回 null，由调用方停下来问人。
 * @param {Array<string|{姓名:string,底色?:string,班次?:string}>} names
 * @param {object} [配置] 不传则读 28号 的 project-config/排班值班配置.json
 * @param {{当前时间?:Date}} [选项] 判定时刻（默认=现在；单测传固定时刻）
 */
function 挑选值班负责人(names, 配置, 选项) {
  const 人 = (names || []).map((n) => (typeof n === 'string' ? { 姓名: n, 底色: '' } : n));
  const 结果 = 值班库.挑值班(人, '售后', 配置 || 排班库.读配置(), 选项);
  return 结果.found ? { userId: 结果.userId, userName: 结果.userName } : null;
}

/** 读「此刻售后谁值班」：由 28号 读排班表底色 + 名单判定（本项目不再自带一份） */
function 读此刻值班(配置) {
  const 用配置 = 配置 || 排班库.读配置();
  const 报告 = 排班库.读排班(undefined, 用配置);
  const 结果 = 值班库.从报告挑值班(报告, '售后', 用配置);
  if (!结果.found) throw new Error('按「底色＋此时此刻在班次」挑不到唯一售后值班人：' + 结果.理由 + '（口径与名单在 28.排班与派活；不猜，停下问人）');
  const 人 = (报告['当日有色人员'] || []).find((x) => x.姓名 === 结果.姓名) || {};
  return [{ 姓名: 结果.姓名, 底色: 结果.底色, 班次: 人.班次 }];
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
    if (!值班) throw new Error('排班表挑不到（此刻）在班的值班人，请显式传 --owner <userid>（不猜）');
    ownerId = 值班.userId;
    ownerName = 值班.userName;
  }
  const rec = 构造记录({ content, ownerId, ownerName, deadline, 优先级 });
  const { docid } = 读表配置();
  const args = ['smartsheet', 'records', 'add', '--docid', docid, '--sheet-title', SHEET, '--records', JSON.stringify([rec])];
  if (dryRun) return { dryRun: true, args, rec };
  const out = execFileSync(process.execPath, [WECOM, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const key = content.slice(0, 20);
  const back = execFileSync(process.execPath, [WECOM, 'smartsheet', 'records', 'list', '--docid', docid, '--sheet-title', SHEET, '--limit', '300'], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
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
module.exports = { 解析参数, 构造记录, 挑选值班负责人, 读此刻值班, 读表配置, 值班库, 排班库, DOCID, SHEET };
