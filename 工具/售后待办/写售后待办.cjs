#!/usr/bin/env node
/**
 * 写售后待办（企微智能表格「售后待办清单」）
 * 用户 2026-09-29 明确：售后的待办事项就是这张子表；对应的是新出的「售前待办清单」。
 *
 * 用法：
 *   node scripts/写售后待办.cjs --content "要售后做什么" [--deadline "2026-09-30 00:00:00"] [--priority 一般] [--dry-run]
 * 说明：
 *   - 只做「新增一行」，不删不改；写完会回读确认（优先认新增返回的 record_id，拿不到才用正文前 20 字）。
 *   - **负责人默认由工具自己查**（28号 排班表「此刻在班」的售后值班人）；查不到就报错不写。
 *     要派给定人：--owner <userid> --owner-name <名字>（两个必须一起给）。
 *   - 2026-11-05 黎路遥问「李某某今天没上班，为何写的是他」→ 拆掉旧的「不传就默默给组长」兜底。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 值班/排班**口径统一在 28号 项目**（用户 2026-09-30：「专门讲安排工作、看排班表…统一迁移到这里来」）：
// 本条只负责“照着 28号 的结论派人”，不再自己维护值班名单/排班表链接。
// 2026-10-11 28号 物理搬走（老地方只剩指路条）→ 引用改新址；备份：D:\备份文件夹\2026-10-11-焦宛儿-改28引用前备份\
const 值班库 = require('D:/硅基公司/员工/04.排班派活专员·焦宛儿/专项/28.排班与派活/src/lib/值班');
const 排班库 = require('D:/硅基公司/员工/04.排班派活专员·焦宛儿/专项/28.排班与派活/src/lib/排班读取');

// 表 docid = **公司私有数据，不进仓库**（仓库是公开的）：从本机配置读，环境变量优先。
// 本机配置：27.企业微信机器人/project-config/售后待办.local.json → {"docid":"s3_…","sheet":"售后待办清单"}
// 2026-10-21 套件统一后，这个脚本搬出旧 27 号（它只给木婉清用，不是公司标准，所以不塞共享那套）：
// 本机配置就跟它放一起，路径不再跨目录。
const 本机配置路径 = path.join(__dirname, '售后待办.local.json');
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
const 组长 = { userId: 'wo******************************', userName: '李某某（售后组长）' };
// 组长**不再是默认负责人**（2026-11-05：他不一定在岗，默默派给他 = 派给不在岗的人）；
// 只有调用方显式传 --owner/--owner-name 才会用到这组 id（在 README 里给他看）。
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
  // 2026-10-18 惨案（焦宛儿报，29 号实测同一坑）：只传 --owner 不传 --owner-name 时，
  // 以前会落成「售后」两个字——表里看上去像派了人、实际不是真人名（微信里也 @ 不到）。
  // 现在：给了 userId 但没给名字，宁可抛错不静默编个假名（宁可停下问人，不许猜）。
  if (ownerId && !ownerName) {
    throw new Error('传了 --owner 就必须同时传 --owner-name（否则负责人会显示成「售后」这种假名，不是真人）；不知道名字就改用 --owner auto');
  }
  // 2026-11-05 黎路遥问：李某某今天没上班，为什么待办里写的是他。
  // 根因就是这一行旧的「没传 owner 就默默给组长 李某某」——**静默兜底**：
  // 组长可能休息/请假，派给他等于派给一个不在岗的人，14 号工单提醒还会白 @ 他。
  // 所以默认改成「查 28号 排班表的此刻值班人」；挑不到就硬报错，不给任何人发。
  if (!ownerId || !ownerName) throw new Error('内部错误：没定下负责人，不许写表（不猜、不兜底）');
  const 负责人 = [{ userId: ownerId, userName: ownerName }];
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

function 写({ content, ownerId: 入参Id, ownerName: 入参名, deadline, 优先级, dryRun }) {
  if (!入参Id && 入参名) throw new Error('只给 --owner-name 不给 --owner（userid）派不了人；不知道 userid 就什么 owner 都别传，工具自己查值班');
  // **默认就是查值班**（黎路遥 2026-11-05 定：一个命令调完，人由工具自己定）：
  // 不传 --owner 与传 --owner auto 完全等价；以前那种「不传就默默给组长李某某」已拆。
  let ownerId = 入参Id;
  let ownerName = 入参名;
  let 来源 = '显式指定';
  if (!ownerId) {
    const 值班 = 挑选值班负责人(读此刻值班());
    if (!值班) throw new Error('排班表挑不到（此刻）在班的值班人：不写、不猜。真得派给定人，就显式传 --owner <userid> --owner-name <名字>');
    ownerId = 值班.userId;
    ownerName = 值班.userName;
    来源 = '值班（排班表此刻在班）';
  }
  const rec = 构造记录({ content, ownerId, ownerName, deadline, 优先级 });
  const { docid } = 读表配置();
  const args = ['smartsheet', 'records', 'add', '--docid', docid, '--sheet-title', SHEET, '--records', JSON.stringify([rec])];
  if (dryRun) return { dryRun: true, 负责人: ownerName, 负责人来源: 来源, args, rec };
  const out = execFileSync(process.execPath, [WECOM, ...args], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const key = content.slice(0, 20);
  const 新行id = (out.match(/"record_id"\s*:\s*"([^"]+)"/) || [])[1] || null;

  // 回读：1000 条一页往后翻，优先认「新行 id」、拿不到 id 才用正文前 20 字兜底。
  // 为什么不再写死 limit 300：2026-11-05 这张表长到 301 行，回读扫不到就误报「未命中」，
  // 而记录其实建成了（李沅茁当天撞上，白查一轮）。翻页 + 双凭据后，表长到几千行也不会假报。
  let hit = false;
  let 方式 = null;
  let 扫了 = 0;
  for (let 页 = 0; 页 < 5 && !hit; 页++) {
    const back = execFileSync(process.execPath, [WECOM, 'smartsheet', 'records', 'list', '--docid', docid, '--sheet-title', SHEET, '--limit', '1000', '--start', String(页 * 1000)], { encoding: 'utf8', maxBuffer: 60 * 1024 * 1024 });
    const 行数 = (back.match(/"record_id"/g) || []).length;
    扫了 += 行数;
    if (新行id ? back.includes(新行id) : back.includes(key)) { hit = true; 方式 = 新行id ? '记录id' : '正文前20字'; }
    if (行数 < 1000) break; // 最后一页
  }
  return { ok: true, 负责人: ownerName, 负责人来源: 来源, 回读命中: hit, 命中方式: 方式, 扫了行数: 扫了, 新行id, 关键词: key, 原始响应长度: out.length };
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
