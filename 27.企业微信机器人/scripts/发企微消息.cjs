#!/usr/bin/env node
// 发企微 markdown 消息（统一入口，避免手拼 JSON 踩坑）。
// 关键：markdown.content 必须是「字符串」；传数组会报 10003 'content' 类型不匹配（单元素数组偶尔被 CLI 的 json repair 救回来 → 表现为时好时坏）。
//
// 用法：
//   node scripts/发企微消息.cjs --chat-id "<本次 sessions list 里的 id>" --file 正文.md
//   node scripts/发企微消息.cjs --chat-id "<id>" --text "一句话"
//   node scripts/发企微消息.cjs --to 黎路遥 --text "一句话"   ← 单聊按名字回（自动查 sessions list 取 chat_id）
//   （加 --dry-run 只打印 payload 不发送；**群 chat_id（wr 开头）默认拒发**，要发群得加 --允许发群并先问人）
//
// 为什么有 --to（2026-10-21，王语嫣报的实案）：单聊来信里 chatid 是空的，只有 fromUserId；
//   以前只能人工去 sessions list 里翻 id，翻不到就不回 → 老板 09:10 问的话到 10:00 还没人答。
//   现在按「人名 → 单聊会话」解析，解析不出/重名就明确报错（**不许猜，猜错就是把消息发给别人**）。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const 项目根 = path.resolve(__dirname, '..');

const 默认CLI脚本 = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@wecom', 'cli', 'bin', 'wecom.js');

function 取参数(argv) {
  const out = { chatId: '', to: '', file: '', text: '', dryRun: false, 允许发群: false, cli: 默认CLI脚本 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = String(argv[i] || '').replace(/^--/, '');
    const next = argv[i + 1];
    if (key === 'chat-id') { out.chatId = String(next || '').trim(); i += 1; } else
    if (key === 'to' || key === 'to-name') { out.to = String(next || '').trim(); i += 1; } else
    if (key === 'file') { out.file = String(next || '').trim(); i += 1; } else
    if (key === 'text') { out.text = String(next || ''); i += 1; } else
    if (key === 'cli') { out.cli = String(next || 'wecom-cli').trim(); i += 1; } else
    if (key === 'dry-run') { out.dryRun = true; } else
    if (key === '允许发群' || key === 'allow-group') {
      // 无值=true；顺手吃掉后面的 true/1/是，省得被当成野参数
      out.允许发群 = true;
      if (/^(true|1|是|yes)$/i.test(String(next || ''))) i += 1;
    }
  }
  return out;
}

function 构造载荷({ chatId, content, 允许发群 = false }) {
  // 反向约束：content 必须是字符串（数组会被服务端 10003 拒掉）。
  if (typeof content !== 'string') {
    throw new Error('正文必须是字符串（markdown.content 不能是数组）');
  }
  const 文本 = content.trim();
  if (!文本) throw new Error('正文为空，不发空消息');
  if (!chatId) throw new Error('缺少 --chat-id（从本次 sessions list 里取，不要手打历史 id）');
  // 反向约束（2026-10-01 用户拍板）：汇报只私发黎路遥，**不许发群**（金牌组等）。群 id 是 wr 开头，单聊是 wo 开头。
  if (!允许发群 && /^wr/i.test(chatId)) {
    throw new Error('这是群 chat_id（wr 开头）：按规矩汇报只私发人，不发金牌组/任何群；确需发群请加 --允许发群，并先在企微问黎路遥');
  }
  return { chat_id: chatId, msg_type: 'markdown', markdown: { content: 文本 } };
}

function 构造CLI参数(载荷, cli脚本 = 默认CLI脚本) {
  // 反向约束：--markdown 必须是「markdown 内容对象」本身；整包请求体只在 --json 里用。
  return [cli脚本, 'message', 'aibot', 'send', '--chat-id', 载荷.chat_id, '--msg-type', 'markdown', '--markdown', JSON.stringify(载荷.markdown)];
}

// ── 单聊解析（--to）：纯函数，便于反向断言 ──────────────────────────
// 规矩：只认 chat_type==='single'；0 条或多条都报错，绝不「挑一个差不多的」。
function 解析单聊(会话列表, 名字) {
  const 名 = String(名字 || '').trim();
  if (!名) throw new Error('--to 后面要写人名（例：--to 黎路遥）');
  const 单聊 = (Array.isArray(会话列表) ? 会话列表 : []).filter((s) => s && s.chat_type === 'single' && s.chat_id);
  const 命中 = 单聊.filter((s) => {
    const n = String(s.chat_name || '');
    return n === 名 || n.startsWith(名) || n.includes(名);
  });
  if (命中.length === 1) return { chat_id: 命中[0].chat_id, chat_name: 命中[0].chat_name };
  const 有的 = 单聊.map((s) => s.chat_name).join('、') || '（一条单聊会话都没有）';
  if (命中.length === 0) throw new Error(`找不到单聊会话「${名}」。现有单聊：${有的}`);
  throw new Error(`「${名}」命中 ${命中.length} 条单聊（${命中.map((s) => s.chat_name).join('、')}）——写全名再发，别猜`);
}

function 取会话列表(cli脚本 = 默认CLI脚本) {
  const 是脚本 = /.js$/i.test(cli脚本);
  const 命令 = 是脚本 ? process.execPath : cli脚本;
  const 前缀 = 是脚本 ? [cli脚本] : [];
  const 结果 = spawnSync(命令, [...前缀, 'message', 'aibot', 'sessions', 'list'], { encoding: 'utf8' });
  const 输出 = `${结果.stdout || ''}${结果.stderr || ''}`;
  let 数据 = null;
  try { 数据 = JSON.parse(输出); } catch { /* 下面再剥壳 */ }
  if (!数据) {
    const 起 = 输出.indexOf('{');
    const 止 = 输出.lastIndexOf('}');
    if (起 < 0 || 止 <= 起) throw new Error('sessions list 没有返回 JSON（CLI 未登录/权限过期？）');
    try { 数据 = JSON.parse(输出.slice(起, 止 + 1)); } catch { throw new Error('sessions list 返回的不是合法 JSON'); }
  }
  if (!Array.isArray(数据.sessions)) throw new Error('sessions list 里没有 sessions 数组');
  return 数据.sessions;
}

// 名字映射落盘：读新消息.cjs 用它把 fromUserId 显示成人名（可选，坏了不影响发信）
function 记名字映射(会话列表) {
  try {
    const 文件 = path.join(项目根, '.state', '企微会话映射.json');
    let 旧 = {};
    try { 旧 = JSON.parse(fs.readFileSync(文件, 'utf8')) || {}; } catch { /* 没有就算了 */ }
    for (const s of 会话列表) if (s && s.chat_id && s.chat_name) 旧[s.chat_id] = s.chat_name;
    fs.mkdirSync(path.dirname(文件), { recursive: true });
    fs.writeFileSync(文件, JSON.stringify(旧, null, 1), 'utf8');
  } catch { /* 映射只是锦上添花 */ }
}

function 读正文(参数) {
  if (参数.text) return 参数.text;
  if (参数.file) {
    const 绝对 = path.isAbsolute(参数.file) ? 参数.file : path.join(项目根, 参数.file);
    return fs.readFileSync(绝对, 'utf8');
  }
  throw new Error('缺少正文：用 --file <md文件> 或 --text <文本>');
}

function main() {
  const 参数 = 取参数(process.argv.slice(2));
  if (参数.to && 参数.chatId) throw new Error('--to 和 --chat-id 只能给一个（--to 是「按人名查单聊」，别两个都传）');
  if (参数.to) {
    const 会话 = 取会话列表(参数.cli);
    记名字映射(会话);
    const 命中 = 解析单聊(会话, 参数.to);
    参数.chatId = 命中.chat_id;
    console.log(`[发企微] --to ${参数.to} → ${命中.chat_name}（单聊）`);
  }
  const 载荷 = 构造载荷({ chatId: 参数.chatId, content: 读正文(参数), 允许发群: 参数.允许发群 });
  // --markdown 收的是「markdown 内容对象」本身（不是整包请求体）：整包会给 --json 用。
  const json = JSON.stringify(载荷.markdown);
  console.log(`[发企微] 正文 ${Buffer.byteLength(json)} 字节（chat_id 不打印）`);
  if (参数.dryRun) {
    console.log('[发企微] dry-run：只校验载荷，不发送');
    return 0;
  }
  // 用 node 直接跑 CLI 脚本（shell:false）：避免 shell 拼接把含引号/中文的 JSON 拼坏 → 服务端报 893001。
  const 是脚本 = /.js$/i.test(参数.cli);
  const 目标 = 参数.cli;
  const 命令 = 是脚本 ? process.execPath : 目标;
  const 前缀 = 是脚本 ? [目标] : [];
  if (!fs.existsSync(目标)) {
    console.error(`[发企微] 找不到 CLI：${目标}（用 --cli 指定 @wecom/cli/bin/wecom.js 的路径）`);
    return 1;
  }
  const 结果 = spawnSync(命令, [...前缀, 'message', 'aibot', 'send', '--chat-id', 参数.chatId, '--msg-type', 'markdown', '--markdown', json], {
    encoding: 'utf8'
  });
  const 输出 = `${结果.stdout || ''}${结果.stderr || ''}`;
  const 成功 = /"success"\s*:\s*true/.test(输出) && 结果.status === 0;
  if (!成功) {
    // 2026-10-19 事故：原来的正则只认 `"code"`，但企微错误返回的是 `errcode`，
    // 于是「消息权限过期（850003）」只被报成 `code=?`——**看得到失败，看不出为什么**。
    // 现在两个键都认，并对 850003 单独说人话（它是「权限过期」，不是「参数错」）。
    const 错误码 = (输出.match(/"(?:errcode|code)"\s*:\s*(\d+)/) || [])[1] || '?';
    const 因权限过期 = 错误码 === '850003';
    console.error(`[发企微] 发送失败（exit=${结果.status} code=${错误码}）`);
    if (因权限过期) {
      console.error(
        [
          '',
          '  ✗ 机器人「消息」权限已过期（850003）——不是参数错，是授权到期。',
          '    收消息/私信仍正常，只有发送全停。',
          '    只能由创建者点：企业微信 → 工作台 → 智能机器人 → 工作秘书·木婉清 → 授权「消息」。',
          '    降级通道（不依赖 aibot）：',
          '      node scripts/发群消息.js --webhook <project-config/群机器人.local.json 里的 url> --text "…" --send',
          '',
        ].join('\n'),
      );
    }
    console.error(输出.replace(/"extra_identity_context"[\s\S]*?\}/g, '').slice(-600));
    return 1;
  }
  console.log('[发企微] 发送成功 ✓');
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

module.exports = { 构造载荷, 构造CLI参数, 取参数, 解析单聊 };
