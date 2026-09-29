// 反向断言：正文必须是字符串，不许再出现「content 传数组」导致 10003 静默失败。
const test = require('node:test');
const assert = require('node:assert');
const { 构造载荷, 取参数 } = require('../scripts/发企微消息.cjs');

test('正常载荷：content 是字符串', () => {
  const 载荷 = 构造载荷({ chatId: 'woXXXX', content: '第一行\n第二行' });
  assert.strictEqual(载荷.msg_type, 'markdown');
  assert.strictEqual(typeof 载荷.markdown.content, 'string');
  assert.strictEqual(载荷.markdown.content, '第一行\n第二行');
  assert.strictEqual(载荷.chat_id, 'woXXXX');
});

test('content 传数组必须直接报错（2026-09-29 实例：10003 类型不匹配）', () => {
  assert.throws(() => 构造载荷({ chatId: 'woXXXX', content: ['a', 'b'] }), /必须是字符串/);
  assert.throws(() => 构造载荷({ chatId: 'woXXXX', content: ['a'] }), /必须是字符串/); // 单元素数组也不许
});

test('空正文 / 缺 chat-id 都不许发', () => {
  assert.throws(() => 构造载荷({ chatId: 'woXXXX', content: '   ' }), /正文为空/);
  assert.throws(() => 构造载荷({ chatId: '', content: 'hi' }), /缺少 --chat-id/);
});

test('参数解析：--dry-run 与 --file/--text', () => {
  assert.strictEqual(取参数(['--chat-id', 'x', '--dry-run']).dryRun, true);
  assert.strictEqual(取参数(['--chat-id', 'x', '--text', '你好']).text, '你好');
  assert.strictEqual(取参数(['--chat-id', 'x', '--file', 'a.md']).file, 'a.md');
});
