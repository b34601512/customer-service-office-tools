#!/usr/bin/env node
// 用「系统原生 Chrome + 调试端口」打开网页，供人工登录/过人机验证。
// 关键：不加载 Playwright，不附带任何自动化参数（--enable-automation 等），否则风控平台会拦验证码。
//
// 用法：
//   node 打开原生Chrome.cjs --url "https://mms.pinduoduo.com/login/" --profile "D:/.../pdd/pdd03/manual" [--port 9337] [--chrome "C:/.../chrome.exe"]
// 起来之后：人手动登录；程序需要用浏览器时再 connectOverCDP('http://127.0.0.1:<port>') 连上去读页面。

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const 风控平台域名 = [
  'pinduoduo.com', 'yangkeduo.com', 'taobao.com', 'tmall.com', 'douyin.com', 'jinritemai.com',
  'jd.com', 'jingdong.com', 'kuaishou.com', 'xiaohongshu.com', 'youzan.com'
];

const 常见Chrome路径 = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

function 解析参数(argv) {
  const out = { url: '', profile: '', port: '9337', chrome: '', keepOpen: true };
  for (let i = 0; i < argv.length; i += 1) {
    const key = String(argv[i] || '').replace(/^--/, '');
    const next = argv[i + 1];
    if (key === 'url') { out.url = String(next || '').trim(); i += 1; } else
    if (key === 'profile') { out.profile = String(next || '').trim(); i += 1; } else
    if (key === 'port') { out.port = String(next || '').trim(); i += 1; } else
    if (key === 'chrome') { out.chrome = String(next || '').trim(); i += 1; }
  }
  if (!out.url) throw new Error('缺少参数 --url');
  if (!out.profile) throw new Error('缺少参数 --profile（原生 Chrome 的 --user-data-dir 目录）');
  if (!/^\d+$/.test(out.port)) throw new Error('--port 必须是数字');
  return out;
}

function 解析Chrome路径(显式路径) {
  const 候选 = 显式路径 ? [显式路径] : 常见Chrome路径;
  for (const p of 候选) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('找不到浏览器可执行文件，请用 --chrome 指定路径');
}

function 构造原生Chrome参数({ url, profile, port }) {
  // 只给原生参数：调试端口 + 画像目录 + 减少弹窗打扰；刻意不出现任何自动化开关。
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--start-maximized',
    '--new-window',
    String(url)
  ];
}

function 是风控平台地址(url) {
  const 文本 = String(url || '').toLowerCase();
  return 风控平台域名.some((d) => 文本.includes(d));
}

function main() {
  const 参数 = 解析参数(process.argv.slice(2));
  const chrome路径 = 解析Chrome路径(参数.chrome);
  if (!fs.existsSync(参数.profile)) throw new Error(`画像目录不存在：${参数.profile}`);
  const 参数列表 = 构造原生Chrome参数(参数);
  const 子进程 = spawn(chrome路径, 参数列表, { detached: true, stdio: 'ignore' });
  子进程.unref();
  console.log(`[原生 Chrome] 已启动：${chrome路径}`);
  console.log(`[原生 Chrome] 调试口：http://127.0.0.1:${参数.port}（读页面用 connectOverCDP 连它）`);
  console.log(`[原生 Chrome] 画像目录：${参数.profile}`);
  if (是风控平台地址(参数.url)) {
    console.log('[原生 Chrome] 这是风控平台：请人工登录/过验证码，程序不要插手；读完记得关窗口释放画像目录。');
  }
  console.log('[原生 Chrome] 参数：' + 参数列表.slice(0, -1).join(' '));
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`[错误] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { 构造原生Chrome参数, 解析参数, 解析Chrome路径, 是风控平台地址 };
