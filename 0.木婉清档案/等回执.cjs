#!/usr/bin/env node
// 等一个任务回执落地（给监听窗挂 Monitor 用）：文件出现 + 大小稳定 2 秒 → 退出 0；超时退出 2。
// 用法：node 等回执.cjs "任务回执/2026-10-01-xxx.md" [最多等分钟数，默认 120]
// 用途：任务窗按规矩"只写回执、不发企微"，监听窗靠它在回执写完时被叫醒。
const fs = require('fs');
const path = require('path');

const 回执目录 = path.join(__dirname, '任务回执');
const 目标参数 = process.argv[2];
if (!目标参数) {
  console.log('用法：node 等回执.cjs "任务回执/xxx.md" [最多等分钟数]');
  process.exit(2);
}
const 目标 = path.isAbsolute(目标参数) ? 目标参数 : path.join(__dirname, 目标参数);
const 上限参数 = Number(process.argv[3]);
const 上限分钟 = Number.isFinite(上限参数) && 上限参数 > 0 ? 上限参数 : 120;
const 起点 = Date.now();
let 上次大小 = -1;
let 稳定次数 = 0;
let 上次心跳分钟 = 0;

const 计时器 = setInterval(() => {
  const 已过分钟 = (Date.now() - 起点) / 60000;
  if (已过分钟 > 上限分钟) {
    console.error(`[等回执] 等了 ${上限分钟} 分钟还没等到：${path.basename(目标)}`);
    clearInterval(计时器);
    process.exit(2);
  }
  // 心跳：Monitor 的「无输出超时」靠输出续命（默认 5 分钟无输出就被杀）——每 60 秒打一行
  if (Math.floor(已过分钟) > 上次心跳分钟) {
    上次心跳分钟 = Math.floor(已过分钟);
    console.log(`[等回执] 还在等（已 ${上次心跳分钟} 分钟）：${path.basename(目标)}`);
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
