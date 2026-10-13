#!/usr/bin/env node
'use strict';
/*
 * 转兼容格式.cjs —— 查视频编码，按需转成「国内平台通吃」的 H.264 + AAC
 *
 * 场景：YouTube（或其它来源）下载的视频电脑能播，发到微信/抖音等平台打不开。
 *       原因通常是 AV1/VP9 编码；本脚本一条命令完成：查编码 → 按需转码 → 验证。
 *
 * 用法：
 *   node 转兼容格式.cjs <输入文件> [--out <输出文件>] [--crf <数字>] [--max-height <像素>] [--force]
 *
 * 约定（安全）：
 *   - 先只读探查；输入已是 h264+aac 时不转（--force 可强制）。
 *   - 输出默认「<原名>-兼容版.mp4」，放在输入同目录。
 *   - 绝不覆盖：输出已存在则拒绝执行；输入文件永不被改写。
 *   - 转完自动验证输出编码，并打印前后文件大小。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---------- 参数 ----------
function usage() {
  console.log('用法：node 转兼容格式.cjs <输入文件> [--out <输出文件>] [--crf 数字] [--max-height 像素] [--force]');
  console.log('说明：把视频转成 H.264+AAC 兼容格式；不覆盖原片，输出已存在则拒绝。');
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  usage();
  process.exit(argv.length === 0 ? 2 : 0);
}

let input = null;
let out = null;
let crf = '21';
let maxHeight = null;
let force = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--out') { out = argv[++i]; }
  else if (a === '--crf') { crf = argv[++i]; }
  else if (a === '--max-height') { maxHeight = argv[++i]; }
  else if (a === '--force') { force = true; }
  else if (!a.startsWith('-') && input === null) { input = a; }
  else { console.error(`未知参数：${a}`); usage(); process.exit(2); }
}
if (!input) { usage(); process.exit(2); }
if (!fs.existsSync(input)) { console.error(`找不到输入文件：${input}`); process.exit(1); }

// ---------- 工具 ----------
function run(cmd, args) {
  // 只收 stdout，stderr 不外漏（错误时再按需打印）
  try {
    return { ok: true, out: execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, err: (e.stderr || e.message || String(e)).toString() };
  }
}

function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  if (!r.ok) {
    console.error('✖ ffprobe 探查失败（装好 ffmpeg/ffprobe 并确认在 PATH 里）：');
    console.error(r.err.trim().split('\n').slice(0, 5).join('\n'));
    process.exit(1);
  }
  const j = JSON.parse(r.out);
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || null;
  const a = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
  return { v, a, size: Number(j.format && j.format.size) || 0 };
}

function human(n) {
  if (!n) return '未知';
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
}

// ---------- 探查输入 ----------
console.log(`输入：${input}`);
const before = probe(input);
const vCodec = before.v ? before.v.codec_name : null;
const aCodec = before.a ? before.a.codec_name : null;
console.log(`当前编码：视频 ${vCodec || '无'} / 音频 ${aCodec || '无'}   大小 ${human(before.size)}`);

const compatible = vCodec === 'h264' && (aCodec === null || aCodec === 'aac');
if (compatible && !force) {
  console.log('✔ 已是 H.264 + AAC —— 国内平台通用，无需转换。（要重转可加 --force）');
  process.exit(0);
}
if (compatible && force) console.log('（已是兼容编码，按 --force 强制重转）');
else console.log('→ 不是 H.264+AAC：转成兼容格式。');

// ---------- 输出路径（绝不覆盖） ----------
if (!out) {
  const dir = path.dirname(path.resolve(input));
  const base = path.basename(input, path.extname(input));
  out = path.join(dir, `${base}-兼容版.mp4`);
}
if (fs.existsSync(out)) {
  console.error(`✖ 输出文件已存在，拒绝覆盖：${out}`);
  console.error('  请先改名/移走它，或用 --out 指定别的文件。');
  process.exit(1);
}

// ---------- 转码 ----------
const args = ['-n', '-i', input];
if (maxHeight) args.push('-vf', `scale=-2:${maxHeight}`);
args.push(
  '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf),
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '128k', out,
);
console.log(`转码中（crf=${crf}${maxHeight ? `，限高 ${maxHeight}` : ''}）…`);
const t0 = Date.now();
const conv = run('ffmpeg', args);
if (!conv.ok) {
  console.error('✖ ffmpeg 转码失败：');
  console.error(conv.err.trim().split('\n').slice(-8).join('\n'));
  process.exit(1);
}

// ---------- 验证 ----------
const after = probe(out);
const okV = after.v && after.v.codec_name === 'h264';
const okA = !after.a || after.a.codec_name === 'aac';
console.log('');
console.log(`✔ 转换完成：${out}`);
console.log(`  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，大小 ${human(before.size)} → ${human(after.size)}`);
console.log(`  验证：视频 ${after.v ? after.v.codec_name : '无'} ${okV ? '✅' : '❌'} / 音频 ${after.a ? after.a.codec_name : '（无音频）'} ${okA ? '✅' : '❌'}`);
if (!okV || !okA) {
  console.error('✖ 验证未通过：输出不是 h264+aac，请检查 ffmpeg 版本或参数。');
  process.exit(1);
}
console.log('  原片未动，两个文件都保留。');
