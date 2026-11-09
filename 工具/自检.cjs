#!/usr/bin/env node
/**
 * 木婉清 · 自检（AGENTS.md「提交前自检」那一行就是它）
 *
 * 做什么：我这种靠自然语言文件驱动的工作区，坏掉从来不会报错——只会悄悄失效。
 * 所以把「每次提交前必须为真」的前四件事 + 收工归档三段变成可执行检查：
 *   ① 必读件里的相对链接全部存在（R37 死链会误导下一个窗口）
 *   ② 必读件体积在限内（200 行 / 40KB，超了就该拆）
 *   ③ 危险操作口令没有出现在会入库的文件里（老板 2026-10-26 19:50：口令不是密码、只是强确认；
 *      这条 只是「提醒」，命中不算安全问题——但别把它当秘密传播）
 *   ④ 本机私有配置没被 git 跟踪（.local.json / .state 之类）
 *   ⑤ 任务书超 24h 没回执（同名比对；已归档到 D:/备份文件夹/ 的回执也算有）
 *   ⑥ 任务回执超 7 天没归档（只提示挪 D:/备份文件夹/，不搬）
 *   ⑦ 记录/断点记录.md「## 在办」里有条目不带 #号（要么开单，要么删）
 *
 * 用法：node 工具/自检.cjs [--json]
 * 退出码：0 全过；1 有问题（明细打出来；⑥只提示，不影响退出码）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MUST_READ = [
  'AGENTS.md',
  '记录/断点记录.md',
  '0.木婉清档案/索引.md',
  '0.木婉清档案/规矩与红线.md',
  '工具/企微/boot-prompt.md',
];
const LIMITS = { lines: 200, bytes: 40 * 1024 };

const problems = [];
const stats = [];

// ① 死链
for (const rel of MUST_READ) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { problems.push(`必读件不存在：${rel}`); continue; }
  const txt = fs.readFileSync(abs, 'utf8');
  const dir = path.dirname(abs);
  for (const m of txt.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    const t = m[1];
    if (/^(https?:|mailto:|#)/.test(t)) continue;
    let p = t;
    try { p = decodeURIComponent(t); } catch { /* 保持原样 */ }
    const target = path.resolve(dir, p);
    if (!fs.existsSync(target)) problems.push(`死链：${rel} → ${t}`);
  }
}

// ② 体积
for (const rel of MUST_READ) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const txt = fs.readFileSync(abs, 'utf8');
  const lines = txt.split('\n').length;
  const bytes = Buffer.byteLength(txt);
  stats.push({ rel, lines, bytes });
  if (lines > LIMITS.lines) problems.push(`超行数：${rel} ${lines} 行 > ${LIMITS.lines}`);
  if (bytes > LIMITS.bytes) problems.push(`超体积：${rel} ${Math.round(bytes / 1024)}KB > 40KB`);
}

// ③ 口令外泄（只比对本机口令文件里的值，不打印口令本身）
let secret = null;
const pwFile = path.join(ROOT, '0.木婉清档案/project-config/危险操作密码.local.json');
if (fs.existsSync(pwFile)) {
  try {
    const j = JSON.parse(fs.readFileSync(pwFile, 'utf8'));
    secret = String(j.密码 || j.password || Object.values(j)[0] || '');
  } catch { problems.push('口令文件存在但解析失败（可能被写坏）'); }
}
if (secret) {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.state', '收件箱', 'media', 'runtime', 'outputs'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(md|json|cjs|mjs|js|txt|ya?ml)$/.test(e.name) && !e.name.endsWith('.local.json')) out.push(p);
    }
    return out;
  };
  for (const f of walk(ROOT)) {
    const txt = fs.readFileSync(f, 'utf8');
    if (txt.includes(secret)) problems.push(`口令出现在会入库的文件里：${path.relative(ROOT, f)}`);
  }
} else {
  problems.push('没找到本机口令文件（0.木婉清档案/project-config/危险操作密码.local.json）');
}

// ④ 私有配置没被跟踪
try {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  for (const line of tracked.split('\n')) {
    const f = line.trim();
    if (!f) continue;
    if (f.endsWith('.local.json') || f.endsWith('.local.json.bak')) problems.push(`私有配置被 git 跟踪：${f}`);
  }
} catch { problems.push('git ls-files 跑不起来（不在仓库里？）'); }

// ── ⑤⑥⑦ 收工归档三段（2026-11-08 加；原四项不动）─────────────────────
const 提示项 = [];
const 新增三段 = { 任务书无回执: [], 回执未归档: [], 断点在办无号: [] };
const 任务目录 = path.join(ROOT, '0.木婉清档案/任务');
const 回执目录 = path.join(ROOT, '0.木婉清档案/任务回执');
const 备份根 = 'D:\\备份文件夹';
const 现在 = Date.now();
const 一天 = 24 * 60 * 60 * 1000;
const 七天 = 7 * 一天;
const 不是任务书 = (名) => /^(索引|README|模板[-_]|任务模板)/i.test(名);
function 读任务类目录(目录) {
  try { return fs.readdirSync(目录).filter((名) => 名.endsWith('.md') && !不是任务书(名)); }
  catch { return null; }
}
function 回执已在归档(名) {
  // 回执可能已经按规矩挪到 D:/备份文件夹/<日期>-木婉清任务归档/任务回执/。
  // 已经归档的回执不是「没回执」；只在当前目录找会把办完的事天天报成红。
  try {
    for (const d of fs.readdirSync(备份根)) {
      if (!d.includes('木婉清任务归档')) continue;
      if (fs.existsSync(path.join(备份根, d, '任务回执', 名))) return true;
    }
  } catch { /* 备份盘读不到就不算找到；下面照报，不静默放过 */ }
  return false;
}

// ⑤ 有任务书、没回执（超过 24 小时的才报）
const 任务书们 = 读任务类目录(任务目录);
if (任务书们 === null) problems.push('任务目录读不到：0.木婉清档案/任务');
else {
  for (const 名 of 任务书们) {
    let st;
    try { st = fs.statSync(path.join(任务目录, 名)); } catch { continue; }
    const 年龄 = 现在 - st.mtimeMs;
    if (年龄 <= 一天) continue;
    if (fs.existsSync(path.join(回执目录, 名))) continue;
    if (回执已在归档(名)) continue;
    新增三段.任务书无回执.push(`${名}（${Math.floor(年龄 / 一天)} 天）`);
  }
  for (const x of 新增三段.任务书无回执) problems.push(`任务书超 24h 没回执：${x}`);
}

// ⑥ 任务回执未归档（超过 7 天的只提示，不搬）
const 回执们 = 读任务类目录(回执目录);
if (回执们 !== null) {
  for (const 名 of 回执们) {
    let st;
    try { st = fs.statSync(path.join(回执目录, 名)); } catch { continue; }
    const 年龄 = 现在 - st.mtimeMs;
    if (年龄 <= 七天) continue;
    新增三段.回执未归档.push(`${名}（${Math.floor(年龄 / 一天)} 天）`);
  }
  for (const x of 新增三段.回执未归档) 提示项.push(`回执超 7 天未归档：${x} → 挪 D:/备份文件夹/（只提示，不搬）`);
}

// ⑦ 断点「## 在办」里没有 #号 的条目
const 断点文件 = path.join(ROOT, '记录/断点记录.md');
try {
  const 文 = fs.readFileSync(断点文件, 'utf8');
  const 段 = 文.split(/^##\s+/m).find((s) => /^在办/.test(s));
  if (!段) problems.push('断点记录里找不到「## 在办」段');
  else {
    const 条目 = [];
    let 当前 = '';
    for (const l of 段.split(/\r?\n/).slice(1)) {
      if (!l.trim()) continue;
      if (/^\s*[-*]\s+/.test(l)) {
        if (当前) 条目.push(当前);
        当前 = l.replace(/^\s*[-*]\s+/, '').trim();
      } else if (当前) {
        当前 += ' ' + l.trim();
      }
    }
    if (当前) 条目.push(当前);
    for (const e of 条目) {
      if (!/#\d+/.test(e)) {
        const 摘要 = e.replace(/\s+/g, ' ').slice(0, 80);
        新增三段.断点在办无号.push(摘要 + (e.length > 80 ? '…' : ''));
      }
    }
    for (const x of 新增三段.断点在办无号) problems.push(`断点在办项没有 #号：${x}（要么开单，要么删）`);
  }
} catch {
  problems.push('断点记录读不到：记录/断点记录.md');
}

// 输出
const json = process.argv.includes('--json');
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, stats, problems, 提示: 提示项, 新增三段 }, null, 2));
} else {
  console.log('必读件体积：');
  for (const s of stats) console.log(`  ${String(s.lines).padStart(4)} 行 ${String(Math.round(s.bytes / 1024)).padStart(3)}KB  ${s.rel}`);
  console.log('\n新增三段（2026-11-08）：');
  console.log(`  ⑤ 任务书无回执（>24h）：${新增三段.任务书无回执.length ? `✗ ${新增三段.任务书无回执.length} 条` : '✓ 0 条'}`);
  console.log(`  ⑥ 回执未归档（>7天）：${新增三段.回执未归档.length ? `△ ${新增三段.回执未归档.length} 条（只提示）` : '✓ 0 条（只提示不搬）'}`);
  console.log(`  ⑦ 断点在办无 #号：${新增三段.断点在办无号.length ? `✗ ${新增三段.断点在办无号.length} 条` : '✓ 0 条'}`);
  if (提示项.length) {
    console.log('\n提示（不影响退出码）：');
    for (const p of 提示项) console.log(`  - ${p}`);
  }
  if (problems.length === 0) console.log('\n✓ 原四项 + 新增三段全过（死链 0 / 体积在限内 / 口令没外泄 / 私有配置没入库 / 任务书有回执 / 回执在归档期 / 在办项有 #号）');
  else {
    console.log(`\n✗ ${problems.length} 个问题：`);
    for (const p of problems) console.log(`  - ${p}`);
  }
}
process.exit(problems.length === 0 ? 0 : 1);
