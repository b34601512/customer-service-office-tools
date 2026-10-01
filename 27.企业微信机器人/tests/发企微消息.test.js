// 反向断言：正文必须是字符串，不许再出现「content 传数组」导致 10003 静默失败。
const test = require('node:test');
const assert = require('node:assert');
const { 构造载荷, 构造CLI参数, 取参数 } = require('../scripts/发企微消息.cjs');

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

test('反向锁：群 chat_id（wr 开头）默认拒发（2026-10-01 用户：只私发，不发金牌组）', () => {
  assert.throws(() => 构造载荷({ chatId: 'wrFqtuEQAA328pVY-8VtQdfmDtzEE-OQ', content: 'hi' }), /群|私发/);
  // 显示写了放行开关才允许
  const 载荷 = 构造载荷({ chatId: 'wrFakeGroup', content: 'hi', 允许发群: true });
  assert.strictEqual(载荷.chat_id, 'wrFakeGroup');
  // 单聊（wo 开头）不受影响
  assert.strictEqual(构造载荷({ chatId: 'woFakeUser', content: 'hi' }).chat_id, 'woFakeUser');
});

test('参数解析：--允许发群 开关（无值或 true 都行）', () => {
  assert.strictEqual(取参数(['--chat-id', 'x', '--允许发群']).允许发群, true);
  assert.strictEqual(取参数(['--chat-id', 'x', '--允许发群', 'true']).允许发群, true);
  assert.strictEqual(取参数(['--chat-id', 'x']).允许发群, false);
  assert.strictEqual(取参数(['--chat-id', 'x', '--allow-group']).允许发群, true);
});

test('命令行参数：--markdown 传的是内容对象，不是整包请求体（2026-09-29 实例：整包→CLI 打 help、exit=2）', () => {
  const 载荷 = 构造载荷({ chatId: 'woXXXX', content: '你好' });
  const args = 构造CLI参数(载荷, 'C:/x/wecom.js');
  const i = args.indexOf('--markdown');
  const markdown = JSON.parse(args[i + 1]);
  assert.deepStrictEqual(Object.keys(markdown), ['content']);
  assert.strictEqual(markdown.content, '你好');
  assert.ok(!('chat_id' in markdown), 'chat_id 不能塞进 --markdown');
  assert.ok(!('msg_type' in markdown), 'msg_type 不能塞进 --markdown');
  assert.strictEqual(args[args.indexOf('--chat-id') + 1], 'woXXXX');
});
