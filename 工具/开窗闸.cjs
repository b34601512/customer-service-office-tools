#!/usr/bin/env node
// 薄壳：真正逻辑在全公司唯一那份 D:/硅基公司/共享/开窗闸/开窗闸.cjs
// 为什么留壳：历史命令（文档/脚本/肌肉记忆）都指向 工具/开窗闸.cjs；两边只有一份真源。
// 注意：退出码必须透传——开任务窗靠它判「能不能开」；壳若恒返回 0，闸就形同虚设（2026-11-26 踩过）。
const r = require('child_process').spawnSync(
  process.execPath,
  ['D:/硅基公司/共享/开窗闸/开窗闸.cjs', ...process.argv.slice(2)],
  { stdio: 'inherit' }
);
process.exit(r.status === null ? 2 : r.status);
