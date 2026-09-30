#!/usr/bin/env node
/**
 * 企微群机器人通知 · **共享核心**（唯一出处，2026-09-30 用户拍板收拢到 27号）
 *
 * 为什么收拢：22/24/25 号各有一份逐字相同的 `src/tools/send-wecom-notice.js`，改一次要改三处。
 * 现在：逻辑都在这里；各项目只留一层很薄的壳（把「自己的配置路径 + 自己的 log」传进来）。
 *
 * ⚠ 口径（用户 2026-09-30）：**群消息统一由「木婉清」（27号 aibot）发**
 *     `cd 27.企业微信机器人 && node scripts/发企微消息.cjs --chat-id "<本次 sessions list 现取的群 chat_id>" --text "…"`
 *     木婉清的消息**不能真 @人**（正文写名字）；只有确实需要真 @ 时才回退到本模块（webhook + mentioned_mobile_list）。
 *
 * 配置（各项目自己的 `project-config/wecom-notify.json`，不入库）：
 *   { "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…", "members": { "缪某某": "138…" } }
 *
 * 安全默认：`--send` 才真发；不加就是预演（只打印）。
 */
const fs = require('fs');
const path = require('path');

const 文本字节上限 = 2048;

/** 解析 CLI 参数：--file / --text / --at 名字… / --send */
function 解析参数(argv) {
  const args = { at: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === '--file') { args.file = argv[i + 1]; i += 1; continue; }
    if (t === '--text') { args.text = argv[i + 1]; i += 1; continue; }
    if (t === '--at') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) { args.at.push(argv[i + 1]); i += 1; }
      continue;
    }
    if (t === '--send') args.send = true;
  }
  return args;
}

/** 读配置（配置不入库；缺了直接报错，不猜） */
function 读配置(配置路径) {
  if (!fs.existsSync(配置路径)) throw new Error(`缺少通知配置：${配置路径}`);
  const config = JSON.parse(fs.readFileSync(配置路径, 'utf8'));
  if (!config.webhookUrl) throw new Error(`${配置路径} 里没有 webhookUrl`);
  return config;
}

/** 名字 → 手机号（企微靠手机号渲染真 @）；配置里没有就报错，别发半截 */
function 解析提及(名单, 配置) {
  return (名单 || []).map((name) => {
    const mobile = (配置.members || {})[name];
    if (!mobile) throw new Error(`配置的 members 里没有「${name}」的手机号，无法 @ 他`);
    return mobile;
  });
}

/** 检查消息体（字节上限 + 行数），返回 {bytes, lines} */
function 检查文本(text, 上限 = 文本字节上限) {
  const bytes = Buffer.byteLength(text, 'utf8');
  const lines = text.split(/\r?\n/).length;
  if (!text.trim()) throw new Error('没有消息内容（用 --file 或 --text 传）');
  if (bytes > 上限) throw new Error(`消息 ${bytes} 字节，超过企微上限 ${上限}，请精简或拆条`);
  return { bytes, lines };
}

/** 真发一条（返回企微原始响应；errcode≠0 抛错） */
async function 发送({ webhookUrl, text, 提及手机号 = [], fetchImpl = fetch }) {
  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: text, mentioned_mobile_list: 提及手机号 } }),
  });
  const result = await response.json();
  if (result.errcode !== 0) throw new Error(`企微返回 errcode=${result.errcode} errmsg=${result.errmsg}`);
  return result;
}

/** 给各项目的壳用的完整命令行流程（配置路径 + 日志函数由调用方注入） */
async function 跑命令行(opts = {}) {
  const {
    配置路径, 项目根 = process.cwd(), 日志 = () => {}, argv = process.argv.slice(2), fetchImpl = fetch, log: 兼容日志,
  } = opts;
  const log = 兼容日志 || 日志;
  const args = 解析参数(argv);
  const config = 读配置(配置路径);
  const text = args.text !== undefined ? args.text : (args.file ? fs.readFileSync(path.resolve(项目根, args.file), 'utf8') : '');
  const { bytes, lines } = 检查文本(text);
  const 提及手机号 = 解析提及(args.at, config);
  log('企微通知', args.send ? '准备发送' : '预演', `${lines} 行 / ${bytes} 字节`, args.at.length ? `@${args.at.join('、')}` : '不@任何人');
  if (!args.send) {
    console.log('\n----- 以下是将要发送的内容（预演，未发送）-----');
    console.log(text);
    console.log('----- 预演结束：加 --send 才会真发 -----\n');
    return { sent: false, bytes, lines, at: args.at };
  }
  await 发送({ webhookUrl: config.webhookUrl, text, 提及手机号, fetchImpl });
  log('企微通知', '发送成功', 'errcode=0', args.at.length ? `@${args.at.join('、')}（${提及手机号.join(',')}）` : '不@任何人');
  console.log(`\n  ✓ 已发送到企微群（errcode=0）${args.at.length ? `，@${args.at.join('、')}` : ''}\n`);
  return { sent: true, bytes, lines, at: args.at };
}

module.exports = { 文本字节上限, 解析参数, 读配置, 解析提及, 检查文本, 发送, 跑命令行 };
