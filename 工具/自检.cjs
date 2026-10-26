#!/usr/bin/env node
/**
 * 木婉清 · 自检（AGENTS.md「提交前自检」那一行就是它）
 *
 * 做什么：我这种靠自然语言文件驱动的工作区，坏掉从来不会报错——只会悄悄失效。
 * 所以把「每次提交前必须为真」的四件事变成可执行检查：
 *   ① 必读件里的相对链接全部存在（R37 死链会误导下一个窗口）
 *   ② 必读件体积在限内（200 行 / 40KB，超了就该拆）
 *   ③ 危险操作口令没有出现在会入库的文件里（口令只许在本机 .local.json）
 *   ④ 本机私有配置没被 git 跟踪（.local.json / .state 之类）
 *
 * 用法：node 工具/自检.cjs [--json]
 * 退出码：0 全过；1 有问题（明细打出来）
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
  '0.木婉清档案/职责.md',
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

// 输出
const json = process.argv.includes('--json');
if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, stats, problems }, null, 2));
} else {
  console.log('必读件体积：');
  for (const s of stats) console.log(`  ${String(s.lines).padStart(4)} 行 ${String(Math.round(s.bytes / 1024)).padStart(3)}KB  ${s.rel}`);
  if (problems.length === 0) console.log('\n✓ 四项全过（死链 0 / 体积在限内 / 口令没外泄 / 私有配置没入库）');
  else {
    console.log(`\n✗ ${problems.length} 个问题：`);
    for (const p of problems) console.log(`  - ${p}`);
  }
}
process.exit(problems.length === 0 ? 0 : 1);
