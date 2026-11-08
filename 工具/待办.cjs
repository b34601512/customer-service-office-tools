#!/usr/bin/env node
'use strict';
/**
 * 木婉清 · 待办（唯一入口：一条命令开 issue）
 *
 * 为什么要有它：待办有时写断点、有时开 issue，断点只活几天，堆着会静默丢失。
 * 从 2026-11-08 起：新待办一律走这里；断点「在办」只许写 `#号（一句话）`。
 *
 * 用法：
 *   node 工具/待办.cjs "一句话" [--body-file 正文.md] [--repo 硅基公司|木婉清]
 *
 * 默认仓库：木婉清（b34601512/customer-service-office-tools，见 AGENTS.md「待办」那一行）
 *   硅基公司 -> c34601512-cpu/silicon-company
 *   木婉清   -> b34601512/customer-service-office-tools
 *
 * 输出：成功只打印一行 `#号（一句话）`，供直接粘进断点记录。
 * 退出码：
 *   0 开单成功且回读标题一致
 *   1 回读标题不一致 / 回读失败（issue 可能已建，错误里会给出能定位的信息）
 *   2 参数错（标题空、仓库名不认识、正文文件读不到）
 *   3 gh 命令失败（没登录、没权限、网络）
 *
 * 边界：不自动重试；查不到就报错，不猜。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const 仓库表 = {
  硅基公司: 'c34601512-cpu/silicon-company',
  木婉清: 'b34601512/customer-service-office-tools',
};
const 默认仓库 = '木婉清';

function 参数(argv) {
  const 位置 = [];
  let 正文文件 = '';
  let 仓库 = 默认仓库;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--body-file' || a === '--repo') {
      const 值 = argv[i + 1];
      if (值 === undefined || 值.startsWith('--')) {
        console.error(`✗ ${a} 后面要跟一个值`);
        process.exit(2);
      }
      if (a === '--body-file') 正文文件 = 值;
      else 仓库 = 值;
      i += 1;
    } else if (a.startsWith('--body-file=')) {
      正文文件 = a.slice('--body-file='.length);
    } else if (a.startsWith('--repo=')) {
      仓库 = a.slice('--repo='.length);
    } else if (a.startsWith('--')) {
      console.error(`✗ 不认识的开关：${a}`);
      console.error('  用法：node 工具/待办.cjs "一句话" [--body-file 正文.md] [--repo 硅基公司|木婉清]');
      process.exit(2);
    } else {
      位置.push(a);
    }
  }
  const 标题 = 位置.join(' ').trim();
  return { 标题, 正文文件, 仓库 };
}

function 跑Gh(参) {
  return execFileSync('gh', 参, { encoding: 'utf8', timeout: 120000 });
}

const { 标题, 正文文件, 仓库 } = 参数(process.argv.slice(2));
if (!标题) {
  console.error('✗ 标题不能为空');
  console.error('  用法：node 工具/待办.cjs "一句话" [--body-file 正文.md] [--repo 硅基公司|木婉清]');
  process.exit(2);
}
if (/[\r\n]/.test(标题)) {
  console.error('✗ 标题只能是一行（长正文请用 --body-file）');
  process.exit(2);
}
const 仓库全名 = 仓库表[仓库];
if (!仓库全名) {
  console.error(`✗ 不认识的仓库：${仓库}（只认：${Object.keys(仓库表).join(' / ')}）`);
  process.exit(2);
}

let 正文 = '（由 工具/待办.cjs 创建；标题即待办）';
if (正文文件) {
  const 绝对 = path.resolve(正文文件);
  try {
    正文 = fs.readFileSync(绝对, 'utf8');
  } catch (e) {
    console.error(`✗ 读不到正文文件：${绝对}（${e.message}）`);
    process.exit(2);
  }
}

let 建单输出 = '';
try {
  建单输出 = 跑Gh(['issue', 'create', '--repo', 仓库全名, '--title', 标题, '--body', 正文]).trim();
} catch (e) {
  const 错 = (e && (e.stderr || e.stdout || e.message)) || '';
  console.error('✗ gh issue create 失败（没有自动重试）：');
  console.error(String(错).trim());
  process.exit(3);
}

// gh issue create 成功时 stdout 是 issue URL；从末尾取号，避免把仓库名里的数字当号。
const m = /\/issues\/(\d+)\s*$/.exec(建单输出);
if (!m) {
  console.error('✗ issue 可能已创建，但输出里解析不出 issue 号；没有自动重试。');
  console.error('  gh 输出：' + 建单输出);
  process.exit(1);
}
const 号 = Number(m[1]);

// 回读：标题必须与写入时一致，否则不算成功（防止 shell/接口偷偷改字）。
let 回读;
try {
  回读 = JSON.parse(跑Gh(['issue', 'view', String(号), '--repo', 仓库全名, '--json', 'number,title']));
} catch (e) {
  const 错 = (e && (e.stderr || e.stdout || e.message)) || '';
  console.error(`✗ 已创建 #${号}，但回读失败；没有自动重试。`);
  console.error('  ' + String(错).trim());
  process.exit(1);
}
const 回读标题 = String(回读.title || '').trim();
if (回读标题 !== 标题) {
  console.error(`✗ 回读标题不一致（#${号}）：`);
  console.error(`  写入：${标题}`);
  console.error(`  回读：${回读标题}`);
  process.exit(1);
}

// 成功只输出这一行，断点直接粘。
console.log(`#${号}（${标题}）`);
