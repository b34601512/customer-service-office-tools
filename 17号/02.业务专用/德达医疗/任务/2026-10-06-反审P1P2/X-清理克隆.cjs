#!/usr/bin/env node
// X-清理：删除 X-克隆画像.cjs 生成的临时克隆画像（含登录 cookie），并确认已消失。
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const DIR = __dirname;

function main() {
  const f = path.join(DIR, 'X-克隆路径.txt');
  if (!fs.existsSync(f)) { console.log('没有 X-克隆路径.txt，无需清理'); return; }
  const clone = fs.readFileSync(f, 'utf8').trim();
  const okPath = path.dirname(clone) === os.tmpdir() && /^tanyu-clone-\d+$/.test(path.basename(clone));
  if (!okPath) throw new Error(`克隆路径不像本任务生成的临时目录，拒绝删除：${clone}`);
  if (fs.existsSync(clone)) fs.rmSync(clone, { recursive: true, force: true });
  const gone = !fs.existsSync(clone);
  fs.rmSync(f, { force: true });
  console.log(`克隆画像 ${clone} 已删除=${gone}`);
  if (!gone) process.exitCode = 1;
}

main();
