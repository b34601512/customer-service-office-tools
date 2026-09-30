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
const 群机器人主机 = 'qyapi.weixin.qq.com';
const 群机器人路径 = '/cgi-bin/webhook/send';
const 请求超时毫秒 = 10000;

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

/** 只允许企微官方群机器人地址（防止把消息发去别的地址），返回解析后的 URL */
function 校验机器人地址(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error('webhook 不是合法 URL');
  }
  if (parsed.hostname !== 群机器人主机 || !parsed.pathname.startsWith(群机器人路径)) {
    throw new Error(`webhook 必须是 https://${群机器人主机}${群机器人路径}?key=... 形式，已拒绝发送`);
  }
  if (!parsed.searchParams.get('key')) throw new Error('webhook 缺少 key 参数');
  return parsed;
}

/** 打印/写日志时用的脱敏地址（key 换 ******） */
function 打码机器人地址(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has('key')) parsed.searchParams.set('key', '******');
    return parsed.toString();
  } catch (error) {
    return '（非法 URL）';
  }
}

/** 造消息体：text（可带 @手机号）或 markdown（不支持 @） */
function 造消息体({ 类型 = 'text', 内容, 提及手机号 = [] } = {}) {
  const content = String(内容 || '').trim();
  if (!content) throw new Error('消息内容为空，nothing to send');
  if (类型 === 'markdown') return { msgtype: 'markdown', markdown: { content } };
  const payload = { msgtype: 'text', text: { content } };
  if ((提及手机号 || []).length > 0) payload.text.mentioned_mobile_list = 提及手机号;
  return payload;
}

/** 真发一条（已造好的消息体）。只试 1 次、不自动重试；errcode≠0 抛错（45009 给限频提示） */
async function 发一条({ webhookUrl, 消息体, fetchImpl = globalThis.fetch, 超时毫秒 = 请求超时毫秒 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 超时毫秒);
  let response;
  let bodyText = '';
  try {
    response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(消息体),
      signal: controller.signal,
    });
    bodyText = await response.text();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`发送失败：${Math.round(超时毫秒 / 1000)} 秒无响应（已放弃，不重试）`);
    throw new Error(`发送失败：${error && error.message ? error.message : error}`);
  } finally {
    clearTimeout(timer);
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`响应不是合法 JSON（HTTP ${response.status}）：${String(bodyText).slice(0, 300)}`);
  }
  if (!response.ok || body.errcode !== 0) {
    const hint = body.errcode === 45009 ? '（触发 20 条/分钟限频，请等待后人工决定是否重发）' : '';
    throw new Error(`发送失败：HTTP ${response.status}，errcode=${body.errcode}，errmsg=${body.errmsg}${hint}`);
  }
  return body;
}

/** 解析群机器人 CLI 参数（27号 「发群消息.js」的那套开关） */
function 解析群机器人参数(argv) {
  const options = { text: '', textFile: '', mention: [], type: 'text', webhook: '', send: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`参数 ${arg} 缺少取值`);
      return argv[i];
    };
    if (arg === '--text') options.text = next();
    else if (arg === '--text-file') options.textFile = next();
    else if (arg === '--mention') options.mention = next().split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--type') {
      options.type = next().trim().toLowerCase();
      if (!['text', 'markdown'].includes(options.type)) throw new Error('--type 只支持 text 或 markdown');
    } else if (arg === '--webhook') options.webhook = next();
    else if (arg === '--send') options.send = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

/** 取正文（--text 与 --text-file 二选一；文件相对当前工作目录） */
function 读正文(options) {
  if (options.text && options.textFile) throw new Error('--text 与 --text-file 只能二选一');
  if (options.textFile) return fs.readFileSync(options.textFile, 'utf8').trim();
  return String(options.text || '').trim();
}

/** 取群机器人地址：--webhook 优先，其次环境变量 WECOM_WEBHOOK_URL */
function 取群机器人地址(options, env = process.env) {
  const url = String((options && options.webhook) || env.WECOM_WEBHOOK_URL || '').trim();
  if (!url) throw new Error('缺少 webhook：请设置环境变量 WECOM_WEBHOOK_URL，或传 --webhook');
  return url;
}

/** 跑群机器人命令行：默认只预览、--send 才真发（webhook 取 --webhook 或环境变量 WECOM_WEBHOOK_URL） */
async function 跑群机器人命令行({ argv = [], env = process.env, fetchImpl = globalThis.fetch, 输出 = console.log } = {}) {
  const options = 解析群机器人参数(argv);
  if (options.help) {
    输出(`用法：
  node scripts/发群消息.js --text "内容" [--mention 手机号,手机号] [--type text|markdown]
  node scripts/发群消息.js --text-file 报告.txt --send

选项：
  --text          消息正文（与 --text-file 二选一）
  --text-file     从文件读正文（适合日报/报告）
  --mention       逗号分隔的手机号，仅 text 类型有效（企微按手机号 @人）
  --type          text（默认）或 markdown
  --webhook       群机器人地址；不传则读环境变量 WECOM_WEBHOOK_URL
  --send          真正发送；不传只预览（默认 dry-run）
  --help          显示本帮助`);
    return { sent: false };
  }
  if (options.text && options.textFile) throw new Error('--text 与 --text-file 只能二选一');
  const content = 读正文(options);
  const payload = 造消息体({ 类型: options.type, 内容: content, 提及手机号: options.mention });
  const rawWebhook = 取群机器人地址(options, env);
  校验机器人地址(rawWebhook);

  输出(`webhook: ${打码机器人地址(rawWebhook)}`);
  输出(`payload: ${JSON.stringify(payload, null, 2)}`);
  if (!options.send) {
    输出('\n[dry-run] 未发送。确认内容无误后加 --send 真发。');
    return { sent: false };
  }
  const result = await 发一条({ webhookUrl: rawWebhook, 消息体: payload, fetchImpl });
  输出(`\n[已发送] errcode=${result.errcode} errmsg=${result.errmsg}`);
  return { sent: true, result };
}

/** 真发一条文本（返回企微原始响应；errcode≠0 抛错） */
async function 发送({ webhookUrl, text, 提及手机号 = [], fetchImpl = fetch }) {
  const 消息体 = 造消息体({ 类型: 'text', 内容: text, 提及手机号 });
  return 发一条({ webhookUrl, 消息体, fetchImpl });
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
  校验机器人地址(config.webhookUrl);
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

module.exports = {
  文本字节上限,
  群机器人主机,
  群机器人路径,
  解析参数,
  读配置,
  解析提及,
  检查文本,
  校验机器人地址,
  打码机器人地址,
  造消息体,
  发一条,
  发送,
  跑命令行,
  // 27号「发群消息.js」那套 CLI（名字保持英文，测试与老调用方都按这套用）
  解析群机器人参数,
  读正文,
  取群机器人地址,
  跑群机器人命令行,
};
