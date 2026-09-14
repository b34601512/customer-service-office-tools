// 咚咚全量记录转换测试：确保机器人自动回复/欢迎语/商品卡片不会被漏掉（漏掉会误伤客服）
const test = require('node:test');
const assert = require('node:assert');
const { imMessagesOf, imSessionsOf, imSessionToChat, summarizeImSessions, classifyMessage } = require('../src/services/jdImFetch');

const ms = (h, m, s) => Date.UTC(2026, 7, 24, h - 8, m, s); // 北京时间 → UTC 毫秒
const msg = (o) => o;

// 倒序（咚咚返回顺序：最新在前）
const raw = {
  code: 0,
  data: [
    msg({ body: { type: 'text', content: '德迩杰', chatinfo: { sid: 'S1' } }, from: { app: 'im.waiter', pin: 'dedakj自营--璇璇' }, datetime: ms(8, 39, 27) }),
    msg({ body: { type: 'text', content: '你这是什么牌子？', chatinfo: { sid: 'S1' } }, from: { app: 'im.customer', pin: 'jd_x' }, datetime: ms(8, 39, 19) }),
    msg({ body: { type: 'text', content: '#E-s33', chatinfo: { sid: 'S1' } }, from: { app: 'im.waiter', pin: 'dedakj自营--璇璇' }, datetime: ms(8, 37, 13) }),
    msg({ body: { type: 'text', content: '亲亲～不用哒～<br/>无需添加任何制氧剂哦～', chatinfo: {} }, from: { app: 'im.waiter', pin: '@im.jd.com' }, datetime: ms(8, 37, 5) }),
    msg({ body: { type: 'text', content: '制氧机要加制氧剂吗？', chatinfo: { sid: 'S1' } }, from: { app: 'im.customer', pin: 'jd_x' }, datetime: ms(8, 37, 5) }),
    msg({ body: { type: 'template2', chatinfo: { pushContent: '欢迎您光临本店' }, data: { tplData: { data: [{ data: { title: '欢迎您光临本店' }, type: 'header' }, { data: { content: '欢迎光临呀～有什么想了解的随时告诉我哦～' }, type: 'richText' }] } } }, from: { app: 'im.waiter', pin: 'DEDAKJ自营--小黛' }, datetime: ms(8, 37, 0) }),
    msg({ body: { type: 'template2', chatinfo: {}, data: { tplData: { data: [{ data: { title: '德国DEDAKJ制氧机，制氧雾化一体机' }, type: 'header' }] } } }, from: { app: 'im.waiter', pin: 'jimi_vender_1000236020' }, datetime: ms(8, 36, 25) })
  ]
};

test('角色判定：机器人/自动应答/模板卡片都算 system', () => {
  assert.deepStrictEqual(classifyMessage({ from: { app: 'im.customer', pin: 'jd_x' }, body: {} }), { role: 'customer', label: '' });
  assert.deepStrictEqual(classifyMessage({ from: { app: 'im.waiter', pin: '@im.jd.com' }, body: { type: 'text' } }), { role: 'system', label: '自动回复' });
  assert.deepStrictEqual(classifyMessage({ from: { app: 'im.waiter', pin: 'dedakj自营--璇璇' }, body: { type: 'text' } }), { role: 'waiter', label: '' });
  // 以店铺账号名义下发的菜单自动答案（action.code=cfg.welcome.new）也是自动回复
  assert.deepStrictEqual(classifyMessage({ from: { app: 'im.waiter', pin: 'DEDAKJ自营--安安' }, body: { type: 'text', action: { code: 'cfg.welcome.new' } } }), { role: 'system', label: '自动回复' });
  // 模板卡片
  assert.strictEqual(classifyMessage({ from: { pin: 'jimi_vender_1000236020' }, body: { type: 'template2' } }).label, '商品卡片');
  assert.strictEqual(classifyMessage({ from: { pin: 'DEDAKJ自营--小黛' }, body: { type: 'template2', chatinfo: { pushContent: '欢迎您光临本店' } } }).label, '欢迎语');
});

test('文本清洗：去 HTML、#E-s 表情编码换成（表情）', () => {
  const list = imMessagesOf(raw);
  const emoji = list.find((m) => m.time.endsWith('08:37:13'));
  assert.strictEqual(emoji.text, '（表情）');
  const bot = list.find((m) => m.label === '自动回复');
  assert.ok(!bot.text.includes('<br'), '不能残留 HTML');
  assert.ok(bot.text.includes('无需添加任何制氧剂哦～'));
  const welcome = list.find((m) => m.label === '欢迎语');
  assert.ok(welcome.text.includes('欢迎您光临本店') && welcome.text.includes('欢迎光临呀'));
});

test('会话分组：无 sid 的系统消息就近挂到会话上', () => {
  const sessions = imSessionsOf(raw);
  assert.strictEqual(sessions.length, 1);
  const s = sessions[0];
  assert.strictEqual(s.sid, 'S1');
  // 6 条有正文的消息（含 3 条系统）+ 客服表情 = 7
  assert.strictEqual(s.messages.length, 7);
  assert.deepStrictEqual(s.messages.map((m) => m.time.slice(11, 19)), ['08:36:25', '08:37:00', '08:37:05', '08:37:05', '08:37:13', '08:39:19', '08:39:27'].sort());
  assert.strictEqual(s.messages.filter((m) => m.role === 'system').length, 3);
  const sum = summarizeImSessions(raw)[0];
  assert.strictEqual(sum.autoCount, 1);
  assert.strictEqual(sum.systemCount, 3);
  assert.strictEqual(sum.customerCount, 2);
});

test('转标准聊天记录：保留系统角色与 label，时间按北京时间', () => {
  const chat = imSessionToChat(imSessionsOf(raw)[0], { customerPin: 'jd_x', tag: '基础答疑' });
  assert.strictEqual(chat.meta.customer, 'jd_x');
  assert.strictEqual(chat.meta.tag, '基础答疑');
  assert.strictEqual(chat.meta.window, '2026-08-24');
  assert.ok(chat.meta.sourceNote.includes('咚咚全量'));
  const sys = chat.messages.filter((m) => m.role === 'system');
  assert.strictEqual(sys.length, 3);
  assert.ok(sys.some((m) => m.label === '自动回复' && m.time === '2026-08-24 08:37:05'));
  const first = chat.messages[0];
  assert.strictEqual(first.time, '2026-08-24 08:36:25');
  assert.strictEqual(first.role, 'system');
});
