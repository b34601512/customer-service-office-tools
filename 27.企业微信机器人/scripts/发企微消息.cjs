#!/usr/bin/env node
// 发企微 markdown 消息（统一入口，避免手拼 JSON 踩坑）。
// 关键：markdown.content 必须是「字符串」；传数组会报 10003 'content' 类型不匹配（单元素数组偶尔被 CLI 的 json repair 救回来 → 表现为时好时坏）。
//
// 用法：
//   node scripts/发企微消息.cjs --chat-id "<本次 sessions list 里的 id>" --file 正文.md
//   node scripts/发企微消息.cjs --chat-id "<id>" --text "一句话"
//   （加 --dry-run 只打印 payload 不发送）

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const 项目根 = path.resolve(__dirname, '..');

function 取参数(argv) {
  const out = { chatId: '', file: '', text: '', dryRun: false, cli: 'wecom-cli' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = String(argv[i] || '').replace(/^--/, '');
    const next = argv[i + 1];
    if (key === 'chat-id') { out.chatId = String(next || '').trim(); i += 1; } else
    if (key === 'file') { out.file = String(next || '').trim(); i += 1; } else
    if (key === 'text') { out.text = String(next || ''); i += 1; } else
    if (key === 'cli') { out.cli = String(next || 'wecom-cli').trim(); i += 1; } else
    if (key === 'dry-run') { out.dryRun = true; }
  }
  return out;
}

function 构造载荷({ chatId, content }) {
  // 反向约束：content 必须是字符串（数组会被服务端 10003 拒掉）。
  if (typeof content !== 'string') {
    throw new Error('正文必须是字符串（markdown.content 不能是数组）');
  }
  const 文本 = content.trim();
  if (!文本) throw new Error('正文为空，不发空消息');
  if (!chatId) throw new Error('缺少 --chat-id（从本次 sessions list 里取，不要手打历史 id）');
  return { chat_id: chatId, msg_type: 'markdown', markdown: { content: 文本 } };
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
  const 载荷 = 构造载荷({ chatId: 参数.chatId, content: 读正文(参数) });
  const json = JSON.stringify(载荷);
  console.log(`[发企微] 正文 ${Buffer.byteLength(json)} 字节（chat_id 不打印）`);
  if (参数.dryRun) {
    console.log('[发企微] dry-run：只校验载荷，不发送');
    return 0;
  }
  const 结果 = spawnSync(参数.cli, ['message', 'aibot', 'send', '--chat-id', 参数.chatId, '--msg-type', 'markdown', '--markdown', json], {
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  const 输出 = `${结果.stdout || ''}${结果.stderr || ''}`;
  const 成功 = /"success"\s*:\s*true/.test(输出) && 结果.status === 0;
  if (!成功) {
    const 错误码 = (输出.match(/"code"\s*:\s*(\d+)/) || [])[1] || '?';
    console.error(`[发企微] 发送失败（exit=${结果.status} code=${错误码}）`);
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

module.exports = { 构造载荷, 取参数 };
