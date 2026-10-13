#!/usr/bin/env node
'use strict';
/*
 * 查配置分层.cjs —— 只读体检：列出常见 AI CLI 的「模型配置」分层现状
 *
 * 用途：某个工具选的模型/推理强度总在重启后变回默认时，
 *       先看清本机到底有几层配置、每层里有哪些模型相关的键——定位「谁在盖谁」。
 *
 * 用法：
 *   node 查配置分层.cjs                  # 扫默认用户目录（os.homedir）
 *   node 查配置分层.cjs --home <目录>    # 指定用户目录（多账号/多用户排查）
 *
 * 只读：不写、不改、不删。缺文件不报错，直接标「不存在」。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let home = os.homedir();
const args = process.argv.slice(2);
const hi = args.indexOf('--home');
if (hi !== -1) {
  if (!args[hi + 1]) {
    console.error('用法：node 查配置分层.cjs [--home <目录>]');
    process.exit(2);
  }
  home = args[hi + 1];
}

// 命中这些字样的键视为「模型相关」
const MODEL_KEY = /(model|provider|reasoning|thinking|effort)/i;

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// ---- 解析器：只提取键值，不做任何修改 ----
function scanJson(p) {
  const t = readText(p);
  if (t == null) return { ok: true, hits: [] };
  try {
    const j = JSON.parse(t);
    const hits = [];
    for (const [k, v] of Object.entries(j)) {
      if (MODEL_KEY.test(k)) hits.push(`${k} = ${JSON.stringify(v)}`);
      if (k === 'env' && v && typeof v === 'object') {
        for (const [ek, ev] of Object.entries(v)) {
          if (MODEL_KEY.test(ek)) hits.push(`env.${ek} = ${JSON.stringify(ev)}`);
        }
      }
    }
    return { ok: true, hits };
  } catch (e) {
    return { ok: false, hits: [], err: `JSON 解析失败：${e.message}` };
  }
}

function scanToml(p) {
  const t = readText(p);
  if (t == null) return { ok: true, hits: [] };
  const hits = [];
  let section = '';
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const mSec = s.match(/^\[([^\]]+)\]/);
    if (mSec) { section = mSec[1]; continue; }
    const mKv = s.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (mKv && MODEL_KEY.test(mKv[1])) {
      hits.push(`${section ? section + '.' : ''}${mKv[1]} = ${mKv[2]}`);
    }
  }
  return { ok: true, hits };
}

// ---- 采集各层 ----
const programData = process.env.ProgramData || 'C:\\ProgramData';
const rows = [];
function add(tool, layer, p, kind) {
  const exists = fs.existsSync(p);
  let info = { ok: true, hits: [] };
  if (exists && kind !== 'none') info = kind === 'json' ? scanJson(p) : scanToml(p);
  rows.push({ tool, layer, p, exists, info });
}

add('Codex CLI', '用户配置（个人真源）', path.join(home, '.codex', 'config.toml'), 'toml');
add('Codex CLI', '系统托管默认（优先级高，可能盖个人）', path.join(programData, 'OpenAI', 'Codex', 'requirements.toml'), 'toml');
add('Claude Code', '用户配置（个人真源）', path.join(home, '.claude', 'settings.json'), 'json');
add('Claude Code', '项目配置（只对当前目录生效）', path.join(process.cwd(), '.claude', 'settings.json'), 'json');
add('Pi', '用户配置（个人真源）', path.join(home, '.pi', 'agent', 'settings.json'), 'json');
add('Pi', '项目配置（只对当前目录生效）', path.join(process.cwd(), '.pi', 'settings.json'), 'json');
// 已知「不是个人配置」的官方文件——列出来只为标记「别当冗余删」
add('Pi', '模型目录缓存（不是配置，别删）', path.join(home, '.pi', 'agent', 'models-store.json'), 'none');

const ENV_KEYS = [
  'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL',
  'OPENAI_MODEL', 'OPENAI_BASE_URL',
  'PI_PROVIDER', 'PI_MODEL', 'PI_THINKING', 'PI_CODING_AGENT_DIR',
  'CLAUDE_CONFIG_DIR', 'CODEX_HOME',
];
const envHits = ENV_KEYS.filter((k) => process.env[k] != null && process.env[k] !== '');

// ---- 输出 ----
console.log('=== AI 工具模型配置分层体检（只读）===');
console.log(`用户目录：${home}`);
console.log(`当前目录：${process.cwd()}`);
console.log('');

let current = '';
for (const r of rows) {
  if (r.tool !== current) { current = r.tool; console.log(`── ${r.tool} ──`); }
  console.log(`[${r.exists ? '有' : '无'}] ${r.layer}`);
  console.log(`      ${r.p}`);
  if (r.exists && r.info.err) console.log(`      ⚠ ${r.info.err}`);
  if (r.exists && r.info.hits && r.info.hits.length) {
    for (const h of r.info.hits) console.log(`      · ${h}`);
  } else if (r.exists && r.info.ok) {
    console.log('      · （未发现模型相关键）');
  }
  console.log('');
}

console.log('── 进程环境变量（进程级覆盖源）──');
if (envHits.length === 0) {
  console.log('  未发现本进程带模型相关的环境变量。');
} else {
  for (const k of envHits) console.log(`  · ${k}=${process.env[k]}`);
}
console.log('');
console.log('提示：');
console.log('  1) 同一工具若同时出现「用户配置」与「系统托管/环境变量」多个模型来源，就可能是覆盖冲突。');
console.log('  2) 只处理冲突的那一层；改前把文件移动到备份目录（可恢复），不要删。');
console.log('  3) 改环境变量后要关掉旧终端/旧会话再开新进程。');
console.log('  4) 本脚本只读，不写、不改。');
