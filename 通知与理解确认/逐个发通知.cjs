#!/usr/bin/env node
/**
 * 逐个发通知：把同一条通知一个一个发给一批人（企微单聊），防限流、能断点续发、落日志。
 *
 * 为什么有它（第 9 条：反复出错的做成工具）：2026-11-03 临时通知客服群，连发第 8 人就被
 * 企微 aibot 拦（846607 frequency limit exceeded），后面靠手写临时脚本硬试，浪费一晚上。
 *
 * 用法：
 *   node 逐个发通知.cjs --配置 <目录>/收件人.json [--干] [--间隔 90] [--最多重试 6]
 *
 * 配置（JSON）：
 *   {
 *     "标题": "2026-11-03-拼3活动",
 *     "正文": "X，麻烦回我一句：……",          ← 用 {小名} / {名字} 占位
 *     "间隔秒": 90,
 *     "收件人": [ {"名字":"韩某某（售前）","小名":"欢欢"}, ... ],
 *     "日志": "发送日志.jsonl"
 *   }
 *
 * 行为：
 *   · 日志里已有「已发」的收件人自动跳过（断点续发，重跑不会重复打扰人）
 *   · 遇 846607 限流：按 15 分钟退避重试，最多 --最多重试 次；仍不行就停下（不硬刷），下次重跑接着发
 *   · 每发一条，追加一行 JSON 到日志（时间/名字/结果）
 *   · 退出码：全发完 0；有未发 2
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const 本目录 = __dirname;
const 企微目录 = path.join(本目录, '..', '工具', '企微');
const 参数 = process.argv.slice(2);
const 取值 = (名, 默认) => {
  const i = 参数.indexOf(名);
  return i >= 0 && 参数[i + 1] ? 参数[i + 1] : 默认;
};
const 配置路径 = 取值('--配置');
if (!配置路径) {
  console.error('用法：node 逐个发通知.cjs --配置 <目录>/收件人.json [--干] [--间隔 90] [--最多重试 6]');
  process.exit(1);
}
const 干跑 = 参数.includes('--干');
const 配置 = JSON.parse(fs.readFileSync(配置路径, 'utf8'));
const 间隔秒 = Number(取值('--间隔', 配置.间隔秒 || 90));
const 最多重试 = Number(取值('--最多重试', 6));
const 退避秒 = Number(取值('--退避', 900));
const 日志路径 = path.join(path.dirname(配置路径), 配置.日志 || '发送日志.jsonl');

const 等 = (秒) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 秒 * 1000);

function 读日志() {
  const 已发 = new Set();
  if (!fs.existsSync(日志路径)) return 已发;
  for (const 行 of fs.readFileSync(日志路径, 'utf8').trim().split(/\r?\n/)) {
    if (!行) continue;
    try {
      const o = JSON.parse(行);
      if (o.结果 === '已发') 已发.add(o.名字);
    } catch { /* 坏行忽略 */ }
  }
  return 已发;
}

function 落日志(记录) {
  fs.appendFileSync(日志路径, JSON.stringify(记录) + '\n', 'utf8');
}

const 已发 = 读日志();
const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), '通知-'));
let 未发 = [];

for (const 人 of 配置.收件人) {
  const 名字 = 人.名字;
  if (已发.has(名字)) {
    console.log(`[跳过] ${名字}（日志里已发）`);
    continue;
  }
  const 正文 = String(配置.正文).replaceAll('{小名}', 人.小名 || 名字).replaceAll('{名字}', 名字);
  if (干跑) {
    console.log(`[干跑] ${名字} ← ${正文.slice(0, 30)}…`);
    continue;
  }
  const 文 = path.join(临时目录, 'm.txt');
  fs.writeFileSync(文, 正文, 'utf8');

  let 成 = false;
  限流: for (let 次 = 1; 次 <= 最多重试; 次++) {
    let 结果 = '';
    try {
      结果 = execFileSync('node', ['发企微.cjs', '--人', 名字, '--file', 文, '--send'], { cwd: 企微目录, encoding: 'utf8' });
    } catch (e) {
      结果 = String((e && e.stdout) || (e && e.message) || '');
    }
    if (/全部发送成功/.test(结果)) {
      成 = true;
      break;
    }
    if (/846607|frequency limit/.test(结果)) {
      console.log(`[限流] ${名字} 第 ${次} 次未成，等 ${退避秒} 秒`);
      等(退避秒);
      continue;
    }
    console.log(`[失败] ${名字}：${结果.trim().split('\n').slice(-1)[0]}`);
    落日志({ 时间: new Date().toISOString(), 名字, 结果: '失败', 明细: 结果.slice(0, 200) });
    break 限流;
  }
  落日志({ 时间: new Date().toISOString(), 名字, 结果: 成 ? '已发' : '未发' });
  if (成) console.log(`[✓] ${名字}`);
  else {
    未发.push(名字);
    console.log(`[✗] ${名字}（配额可能用尽，晚点重跑即可续发）`);
    break; // 一个发不出去就别继续撞墙
  }
  if (间隔秒 > 0) 等(间隔秒);
}

console.log(未发.length ? `未发：${未发.join('、')}（配额恢复后重跑同一条命令即可）` : '全部发完');
process.exit(未发.length ? 2 : 0);
