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

// 日期范围自动放开（2026-09-15 踩坑）：页面默认只查「今天」，老会话的行不会出现 → NO_ROW。
// 抓取前必须点日期选择器的「近30天」快捷项，否则任何老会话都抓不到全量记录。
const { ensureWideDateRange, dateRangeExpr, RANGE_PRESET } = require('../src/services/jdImFetch');

test('dateRangeExpr：能算出日期跨度（今天=0，30天=28~30）', () => {
  const fakeDoc = (start, end) => ({
    querySelectorAll: () => [
      { placeholder: '开始日期', value: start },
      { placeholder: '结束日期', value: end }
    ]
  });
  const run = (s, e) => JSON.parse(new Function('document', `return ${dateRangeExpr()}`)(fakeDoc(s, e)));
  assert.strictEqual(run('2026-09-15 00:00:00', '2026-09-15 23:59:59').spanDays, 0);
  assert.ok(run('2026-08-16 00:00:00', '2026-09-14 23:59:59').spanDays >= 25);
  assert.strictEqual(run('', '').spanDays, 0);
});

test('ensureWideDateRange：范围够宽就不动；太窄就点「近30天」', async () => {
  const clicks = [];
  const deps = {
    clickAt: async (ws, id, x, y) => clicks.push([id, x, y]),
    sleep: async () => {},
    evaluate: async (ws, id, expr) => {
      if (expr.includes('spanDays')) {
        // 第一次探到「今天」，点完预设后再探到 30 天
        return id < 45 ? JSON.stringify({ start: '2026-09-15 00:00:00', end: '2026-09-15 23:59:59', spanDays: 0 })
          : JSON.stringify({ start: '2026-08-16 00:00:00', end: '2026-09-14 23:59:59', spanDays: 29 });
      }
      if (expr.includes('开始日期')) return JSON.stringify({ x: 400, y: 300 });
      if (expr.includes(JSON.stringify(RANGE_PRESET))) return JSON.stringify({ x: 260, y: 557 });
      return '';
    }
  };
  assert.strictEqual(await ensureWideDateRange({}, { deps }), 'ok');
  assert.strictEqual(clicks.length, 2, '应点一次日期框 + 一次快捷项');
  assert.strictEqual(clicks[1][1], 260);

  const wide = await ensureWideDateRange({}, {
    deps: { ...deps, evaluate: async () => JSON.stringify({ spanDays: 40 }) }
  });
  assert.strictEqual(wide, 'already-wide');
});

test('新版页面的全量入口：会生成点「切换为该用户全部聊天信息」的表达式', () => {
  const { switchToFullLogExpr, FULL_LOG_SWITCH_TEXT } = require('../src/services/jdImFetch');
  assert.strictEqual(FULL_LOG_SWITCH_TEXT, '切换为该用户全部聊天信息');
  const expr = switchToFullLogExpr();
  assert.ok(expr.includes(FULL_LOG_SWITCH_TEXT), '表达式里要包含按钮文案');
  assert.ok(expr.includes('querySelectorAll'), '要在页面里找按钮');
});
