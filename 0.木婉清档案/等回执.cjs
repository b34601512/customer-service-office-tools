#!/usr/bin/env node
// 等一个任务回执落地（给监听窗挂 Monitor 用）：文件出现 + 大小稳定 2 秒 → 退出 0；超时退出 2。
// 用法：node 等回执.cjs "任务回执/2026-10-01-xxx.md" [最多等分钟数，默认 120] [--心跳 <分钟>]
// 用途：任务窗按规矩"只写回执、不发企微"，监听窗靠它在回执写完时被叫醒。
// ⚠ 心跳默认**关**：每行输出都会唤醒监听窗一轮（烧 token）——需要心跳时请配 Monitor 的「无输出超时」再显式开。
const fs = require('fs');
const path = require('path');

const 回执目录 = path.join(__dirname, '任务回执');
const 原始参数 = process.argv.slice(2);
const 心跳位 = 原始参数.indexOf('--心跳');
const 已用 = new Set();
if (心跳位 >= 0) {
  已用.add(心跳位);
  已用.add(心跳位 + 1);
}
const 心跳分钟 = 心跳位 >= 0 ? Number(原始参数[心跳位 + 1]) || 0 : 0;
const 剩余 = 原始参数.filter((x, i) => !已用.has(i));
const 目标参数 = 剩余[0];
const 上限参数 = Number(剩余[1]);
const 上限分钟 = Number.isFinite(上限参数) && 上限参数 > 0 ? 上限参数 : 120;
if (!目标参数) {
  console.log('用法：node 等回执.cjs "任务回执/xxx.md" [最多等分钟数]');
  process.exit(2);
}
const 目标 = path.isAbsolute(目标参数) ? 目标参数 : path.join(__dirname, 目标参数);
const 起点 = Date.now();
let 上次大小 = -1;
let 稳定次数 = 0;
let 上次心跳次数 = 0;

const 计时器 = setInterval(() => {
  const 已过分钟 = (Date.now() - 起点) / 60000;
  if (已过分钟 > 上限分钟) {
    console.error(`[等回执] 等了 ${上限分钟} 分钟还没等到：${path.basename(目标)}`);
    clearInterval(计时器);
    process.exit(2);
  }
  // 心跳（默认关）：开了就每 N 分钟打一行，给 Monitor 的「无输出超时」续命
  if (心跳分钟 > 0 && Math.floor(已过分钟 / 心跳分钟) > 上次心跳次数) {
    上次心跳次数 = Math.floor(已过分钟 / 心跳分钟);
    console.log(`[等回执] 还在等（已 ${Math.floor(已过分钟)} 分钟）：${path.basename(目标)}`);
  }
  let 大小 = -1;
  try { 大小 = fs.statSync(目标).size; } catch (e) { /* 还没出现 */ }
  if (大小 > 0 && 大小 === 上次大小) {
    稳定次数 += 1;
    if (稳定次数 >= 2) {
      console.log(`[等回执] 出现并稳定：${path.basename(目标)}（${大小} 字节）`);
      clearInterval(计时器);
      process.exit(0);
    }
  } else {
    稳定次数 = 0;
  }
  上次大小 = 大小;
}, 1000);
