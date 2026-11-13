#!/usr/bin/env node
'use strict';
/**
 * 木婉清 · 链条体检（监听链是否还活着）
 *
 * 为什么要有它：会话重启会把「事件 Loop + Monitor 跟读进程」一起收走，断了不报错，
 * 空档期错过了什么没人知道（2026-11-08 一上午断了 4 次）。所以把「链在不在」变成一条命令。
 *
 * 用法：node 工具/链条体检.cjs
 * 退出码：0＝HEALTHY；1＝BROKEN（明细打出来，并给三行重挂步骤）
 *
 * 看五段（判据都落在可复查的文件/进程上，不猜）：
 *   ① 跟读进程：.state/跟读收件箱.pid 里的 pid 还活着吗（process.kill(pid, 0)）
 *   ② 跟读心跳：.state/收件箱跟读.json 的 mtime 距今多少秒（>120 秒算可疑）
 *      —— 这个文件只在「有新消息、游标前进」时写；空闲时 mtime 不动是正常的。
 *         所以「心跳旧」只有同时「游标落后（有新消息没跟）」才判 BROKEN，避免空闲误报。
 *   ③ 未读滞期：收件箱/inbox.jsonl 总条数 vs 收件箱/已读位置.json 的行数；
 *      最老一条未读距今多少分钟（只报数，链路在跑就不据此判坏——处理滞后看这个数）。
 *   ④ 现役定时：node 环.cjs 列 解析条数与名字，跟白名单比对，多的少的都报。
 *   ⑤ 发送口（守护）：能收 ≠ 能发。走发消息同一条路探活（curl GET + x-zhaomin 令牌，回 {认证:true} 才算通）。
 *      为什么单列（2026-11-13 实测）：守护夜里死了，pid 被 Windows 回收给别的进程（8956 变成 XboxService），
 *      守护控制.mjs 只看「pid 还活着」→ 状态报在跑，08:05 复述一条都发不出去，事后才发现。
 *      它不是排期环、也不是跟读进程，①②③④ 都照不到它。
 *
 * 白名单为什么不是任务书里那两个字面名字（2026-11-08 实跑为准）：
 *   · 「监听企微」不是排期环，它是本文件①②③核的 Monitor 跟读进程；
 *   · 「08:00 复述巡检员」的兜底环实际 id 是「复述巡检员-兜底」，每天 08:05；
 *   · boot-prompt 第二节明列现役还有「笔记维护」，每天 19:30（收工归档那条）。
 *   所以环白名单按实际授权条目比对；若任务书口径变了，改下面 环白名单 一处。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const 企微 = path.join(ROOT, '工具', '企微');
const 状态目录 = path.join(企微, '.state');
const 收件箱目录 = path.join(企微, '收件箱');

const pid文件 = path.join(状态目录, '跟读收件箱.pid');
const 心跳文件 = path.join(状态目录, '收件箱跟读.json');
const 收件箱文件 = path.join(收件箱目录, 'inbox.jsonl');
const 已读文件 = path.join(收件箱目录, '已读位置.json');

// 现役排期环白名单：名字必须精确匹配；时间只核对「几点几分」，日期类型不限。
const 环白名单 = [
  { 名: '复述巡检员-兜底', 时间: '08:05', 因为: '08:00 复述巡检员的兜底' },
  { 名: '笔记维护', 时间: '19:30', 因为: 'boot-prompt 第二节明列的现役' },
];
const 不是环的名字 = new Map([
  ['监听企微', '它不是排期环，是 Monitor 跟读进程；由①进程/②心跳/③游标三段核'],
]);

const 问题 = [];
const 注意 = [];
const 行 = [];

function 人性秒(秒) {
  const s = Math.max(0, Math.round(秒));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m} 分 ${r} 秒`;
}
function 人性分钟(分) {
  if (分 < 60) return `${Math.round(分)} 分钟`;
  const h = Math.floor(分 / 60);
  const m = Math.round(分 % 60);
  return `${h} 小时 ${m} 分钟`;
}
function 读Json(文件) {
  return JSON.parse(fs.readFileSync(文件, 'utf8'));
}
function 读行(文件) {
  if (!fs.existsSync(文件)) return null;
  // 跟 跟读收件箱.mjs 同一判据：只算「以换行结尾的完整行」，末尾半行留到下一轮。
  // 否则半个 JSON 会被算成一条新消息，体检会假报「游标落后」。
  const 文 = fs.readFileSync(文件, 'utf8');
  const 尾切 = 文.lastIndexOf('\n');
  const 完整 = 尾切 >= 0 ? 文.slice(0, 尾切) : '';
  return 完整.split('\n').map((l) => l.trim()).filter(Boolean);
}
function 解析时间(s) {
  if (!s) return NaN;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

// ── ① 跟读进程 ────────────────────────────────────────────────────────────
let pid = 0;
let pid活 = false;
try {
  const 文 = fs.readFileSync(pid文件, 'utf8').trim();
  const m = /^(\d+)/.exec(文);
  if (!m) throw new Error(`pid 文件内容不是数字：「${文.slice(0, 40)}」`);
  pid = Number(m[1]);
  if (!pid) throw new Error('pid 是 0');
  try {
    process.kill(pid, 0);
    pid活 = true;
  } catch (e) {
    if (e && e.code === 'EPERM') pid活 = true; // 有权限限制，但进程存在
    else if (e && e.code === 'ESRCH') pid活 = false;
    else throw new Error(`探活失败：${e && e.code ? e.code : e && e.message}`);
  }
  if (pid活) 行.push(`跟读进程  ✓ PID ${pid} 活着`);
  else {
    行.push(`跟读进程  ✗ PID ${pid} 已不在`);
    问题.push(`跟读进程死了：pid 文件写的是 ${pid}，但进程已不存在`);
  }
} catch (e) {
  行.push(`跟读进程  ✗ 读不到/判不了（${e.message}）`);
  问题.push(`跟读进程判不了：${e.message}`);
}

// ── ② 跟读心跳 + 跟读游标 ─────────────────────────────────────────────────
let 心跳年龄秒 = null;
let 已播条数 = null;
let 总条数 = null;
try {
  const st = fs.statSync(心跳文件);
  心跳年龄秒 = (Date.now() - st.mtimeMs) / 1000;
  const j = 读Json(心跳文件);
  已播条数 = Math.max(0, Math.trunc(Number(j.已播条数) || 0));
  行.push(`跟读心跳  ${心跳年龄秒 > 120 ? '△' : '✓'} ${人性秒(心跳年龄秒)}前更新`);
} catch (e) {
  行.push(`跟读心跳  ✗ 读不到（${e.message}）`);
  问题.push(`跟读心跳读不到：${心跳文件}（${e.message}）`);
}

const 收件行 = 读行(收件箱文件);
if (收件行 === null) {
  行.push('跟读游标  ✗ 收件箱不存在');
  问题.push(`收件箱不存在：${收件箱文件}`);
} else {
  总条数 = 收件行.length;
  if (已播条数 === null) {
    行.push('跟读游标  ✗ 读不到（心跳文件坏了）');
  } else if (已播条数 > 总条数) {
    行.push(`跟读游标  ✗ 已播 ${已播条数} > 总条数 ${总条数}`);
    问题.push(`跟读游标错位：已播 ${已播条数} 条，但收件箱只有 ${总条数} 条（文件被截断/游标坏）`);
  } else {
    const 落后 = 总条数 - 已播条数;
    if (落后 === 0) {
      行.push(`跟读游标  ✓ 已跟平 ${已播条数}/${总条数}`);
      if (心跳年龄秒 !== null && 心跳年龄秒 > 120) {
        注意.push(`心跳 ${人性秒(心跳年龄秒)}没更新，但游标已跟平（${已播条数}/${总条数}），属空闲，不判坏`);
      }
    } else if (心跳年龄秒 !== null && 心跳年龄秒 > 120) {
      行.push(`跟读游标  ✗ 落后 ${落后} 条（已播 ${已播条数}/${总条数}），心跳 ${人性秒(心跳年龄秒)}没动`);
      问题.push(`有新消息没被跟读：游标落后 ${落后} 条，心跳已 ${人性秒(心跳年龄秒)}没更新`);
    } else {
      行.push(`跟读游标  △ 落后 ${落后} 条（已播 ${已播条数}/${总条数}），心跳还新，可能正在追`);
      注意.push(`游标落后 ${落后} 条，但心跳还新；若持续不追平再重挂`);
    }
  }
}

// ── ③ 未读滞期 ────────────────────────────────────────────────────────────
let 未读条数 = null;
if (收件行 !== null) {
  try {
    const 已读 = 读Json(已读文件);
    const 已读行数 = Math.max(0, Math.trunc(Number(已读.行数) || 0));
    if (已读行数 > 总条数) {
      行.push(`未读滞期  ✗ 已读位置 ${已读行数} > 总条数 ${总条数}`);
      问题.push(`已读位置错位：行数 ${已读行数}，但收件箱只有 ${总条数} 条（文件被重写/游标坏）`);
    } else {
      未读条数 = 总条数 - 已读行数;
      if (未读条数 === 0) {
        行.push(`未读滞期  ✓ 0 条未读（已读 ${已读行数}/${总条数}）`);
      } else {
        const 最老 = 收件行[已读行数];
        let 时 = NaN;
        try { 时 = 解析时间(JSON.parse(最老).at || JSON.parse(最老).receivedAt); } catch { /* 下面报 */ }
        if (!Number.isFinite(时)) {
          行.push(`未读滞期  ✗ ${未读条数} 条未读；最老一条时间读不出`);
          问题.push(`有 ${未读条数} 条未读，但最老一条的时间解析失败（第 ${已读行数 + 1} 行）`);
        } else {
          const 分钟 = (Date.now() - 时) / 60000;
          行.push(`未读滞期  △ ${未读条数} 条未读；最老一条 ${人性分钟(分钟)}前（第 ${已读行数 + 1} 行）`);
          注意.push(`有 ${未读条数} 条未读，最老 ${人性分钟(分钟)}前；链路在跑，处理滞后看这里`);
        }
      }
    }
  } catch (e) {
    行.push(`未读滞期  ✗ 读不到已读位置（${e.message}）`);
    问题.push(`已读位置读不到：${已读文件}（${e.message}）`);
  }
}

// ── ④ 现役定时环 ──────────────────────────────────────────────────────────
let 环条 = null;
try {
  const out = execFileSync(process.execPath, ['环.cjs', '列'], {
    cwd: 企微,
    encoding: 'utf8',
    timeout: 30000,
  });
  const 头 = /共\s*(\d+)\s*条/.exec(out);
  const 解析 = [];
  for (const l of out.split(/\r?\n/)) {
    const m = /^\s*[-*・·]\s*(.+?)\s*\[([^\]]+)\]\s*$/.exec(l);
    if (m) 解析.push({ 名: m[1].trim(), 何时: m[2].trim() });
  }
  if (!头) throw new Error('输出里找不到「共 N 条」');
  const 头数 = Number(头[1]);
  if (头数 !== 解析.length) throw new Error(`头部说 ${头数} 条，实际解析到 ${解析.length} 条（输出格式变了？）`);
  环条 = 解析;
} catch (e) {
  行.push(`现役定时  ✗ 环.cjs 列 跑不起来/解析失败（${e.message}）`);
  问题.push(`现役定时判不了：${e.message}`);
}

if (环条 !== null) {
  const 实有 = new Map(环条.map((x) => [x.名, x]));
  const 白有 = new Map(环白名单.map((x) => [x.名, x]));
  const 多 = [...实有.keys()].filter((n) => !白有.has(n));
  const 少 = [...白有.keys()].filter((n) => !实有.has(n));
  行.push(`现役定时  ${多.length || 少.length ? '✗' : '✓'} ${环条.length} 条（白名单 ${环白名单.length} 条）`);
  for (const x of 环条) {
    if (白有.has(x.名)) {
      const 白 = 白有.get(x.名);
      const 时 = /(\d{1,2}:\d{2})/.exec(x.何时);
      const 时对 = !时 || 时[1].padStart(5, '0') === 白.时间;
      行.push(`          ${时对 ? '✓' : '✗'} ${x.名} [${x.何时}]${时对 ? '' : `（白名单 ${白.时间}）`}`);
      if (!时对) 问题.push(`环「${x.名}」时间不对：现在 ${x.何时}，白名单 ${白.时间}`);
    } else {
      行.push(`          ✗ ${x.名} [${x.何时}]（不在白名单）`);
      问题.push(`多了一条环：${x.名} [${x.何时}]（不在白名单；老板 11-06 定只留授权的那几条）`);
    }
  }
  for (const n of 少) {
    行.push(`          ✗ 缺白名单环：${n}（${白有.get(n).时间}）`);
    问题.push(`少了一条环：${n}（白名单要求 ${白有.get(n).时间}，${白有.get(n).因为}）`);
  }
  for (const [n, 说明] of 不是环的名字) {
    if (实有.has(n)) {
      行.push(`          ✗ ${n} 被登记成了排期环（${说明}）`);
      问题.push(`${n} 不应登记成排期环：${说明}`);
    } else {
      行.push(`          · ${n}：${说明}`);
    }
  }
}

// ── ⑤ 发送口（守护）──────────────────────────────────────────────────────
// 判据＝真的能发得出去：HTTP GET 带令牌回 {认证:true}。只探端口不够——端口通但连接掉了，发消息照样失败。
let 发送口通 = null;
{
  const 端口文件 = path.join(收件箱目录, '守护.port');
  const 令牌文件 = path.join(收件箱目录, '守护.token');
  const 守护pid文件 = path.join(收件箱目录, '守护.pid');
  let 端口 = 0;
  let 令牌 = '';
  let 守护pid = '?';
  try { 守护pid = fs.readFileSync(守护pid文件, 'utf8').trim() || '?'; } catch { /* 下面照报 */ }
  try {
    端口 = Number(fs.readFileSync(端口文件, 'utf8').trim()) || 0;
    令牌 = fs.readFileSync(令牌文件, 'utf8').trim();
    if (!端口 || !令牌) throw new Error('守护.port / 守护.token 是空的');
    let 应答 = '';
    try {
      应答 = execFileSync('curl', ['-sS', '--max-time', '3', '-H', `x-zhaomin: ${令牌}`, `http://127.0.0.1:${端口}/`],
        { encoding: 'utf8', timeout: 8000 });
    } catch (e) {
      应答 = String((e && e.stdout) || (e && e.stderr) || (e && e.message) || '').trim();
    }
    if (/"认证"\s*:\s*true/.test(应答)) {
      发送口通 = true;
      行.push(`发送口守护  ✓ PID ${守护pid} 在听 127.0.0.1:${端口}（认证通）`);
    } else {
      发送口通 = false;
      行.push(`发送口守护  ✗ 127.0.0.1:${端口} 认证不通（pid 文件写 ${守护pid}）`);
      问题.push(`发送口不通（能收不能发）：${应答.slice(0, 120) || '无应答'}。` +
        `守护多半已经死了、pid 文件是旧号（PID 会被 Windows 回收给别的程序）。` +
        `修：node 工具/企微/守护控制.mjs 状态；pid 指向的不是 node，就把 收件箱/守护.pid 挪进 D:/备份文件夹，` +
        `再 node 工具/企微/守护控制.mjs 启动。别加 --接管——它会 taskkill 掉被回收的那个无关进程。`);
    }
  } catch (e) {
    发送口通 = false;
    行.push(`发送口守护  ✗ ${e.message}`);
    问题.push(`发送口判不了：${e.message}（守护没启动过？先 node 工具/企微/守护控制.mjs 启动）`);
  }
}

// ── 输出 ──────────────────────────────────────────────────────────────────
const 结论 = 问题.length ? 'BROKEN' : 'HEALTHY';
console.log(`木婉清 · 链条体检 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
console.log('─'.repeat(60));
for (const l of 行) console.log('  ' + l);
if (注意.length) {
  console.log('');
  for (const x of 注意) console.log('  △ ' + x);
}
console.log('─'.repeat(60));
console.log(`结论：${结论}${问题.length ? `（${问题.length} 个问题）` : ''}`);
if (问题.length) {
  console.log('');
  for (const x of 问题) console.log('  ✗ ' + x);
  console.log('');
  if (发送口通 === false) console.log('发送口：按上面「发送口不通」那条修（先 守护控制.mjs 状态，再挪旧 pid、启动）；下面三条只管接收链。');
  console.log('重挂（先 Loop 再 Monitor，顺序别反）：');
  console.log('  1. 先挂事件 Loop：monitor:output（recurring / 30d / maxFires 5000）');
  console.log('  2. 再起 Monitor：cd "D:/桌面/木婉清/工具/企微" && node 跟读收件箱.mjs --接管（timeout=0）');
  console.log('  3. 起来后重跑：node 工具/链条体检.cjs（有未读再 node 读收件箱.mjs 补）');
}
process.exit(问题.length ? 1 : 0);
