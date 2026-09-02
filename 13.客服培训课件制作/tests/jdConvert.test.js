const test = require('node:test');
const assert = require('node:assert');
const { summarizeSessions, rawSessionToChat, sessionsOf } = require('../src/services/jdConvert');

const raw = {
  chatLogList: [
    { sid: 'S1', customer: 'jd_a', waiter: 'w1', closeTypeDesc: '正常',
      chatLogMessageList: [
        { created: '2026-08-05 10:00:01', content: '在吗', waiterSend: 0 },
        { created: '2026-08-05 10:00:03', content: '在的', waiterSend: 1 }
      ] },
    { sid: 'S2', customer: 'jd_b', waiter: 'w2',
      chatLogMessageList: [
        { created: '2026-08-05 11:00:01', content: '降价吗', waiterSend: 0 },
        { created: '2026-08-05 11:00:06', content: '现在不能降价', waiterSend: 1 },
        { created: '2026-08-05 11:00:09', content: '好吧', waiterSend: 0 }
      ] }
  ]
};

test('sessionsOf / summarizeSessions 摘要', () => {
  assert.strictEqual(sessionsOf(raw).length, 2);
  const sum = summarizeSessions(raw);
  assert.strictEqual(sum.length, 2);
  assert.strictEqual(sum[0].sid, 'S2'); // 按时间倒序排前
  assert.strictEqual(sum[0].messageCount, 3);
});

test('rawSessionToChat：缺省取消息最多会话，按时间正序', () => {
  const chat = rawSessionToChat(raw, {});
  assert.strictEqual(chat.meta.platform || chat.platform, 'jd');
  assert.strictEqual(chat.messages.length, 3);
  assert.strictEqual(chat.messages[0].role, 'customer');
  assert.strictEqual(chat.messages[1].role, 'waiter');
  assert.strictEqual(chat.meta.window, '2026-08-05');
  assert.ok(chat.messages.every((m, i, a) => i === 0 || a[i - 1].time <= m.time));
});

test('rawSessionToChat：指定 sid', () => {
  const chat = rawSessionToChat(raw, { sid: 'S1' });
  assert.strictEqual(chat.messages.length, 2);
  assert.strictEqual(chat.meta.customer, 'jd_a');
});

test('buildQueryUrl / buildFetchExpression（jdFetch 导出）', () => {
  const jd = require('../src/services/jdFetch');
  const url = jd.buildQueryUrl('https://kf.jd.com/chatLog/queryList.action', {
    customer: 'jd_abc', startTime: '2026-08-05', endTime: '2026-08-05', page: 1, pageSize: 50
  });
  assert.ok(url.includes('customer=jd_abc'));
  assert.ok(url.includes('startTime=2026-08-05'));
  const expr = jd.buildFetchExpression('https://kf.jd.com/chatLog/queryList.action', { customer: 'jd_abc', startTime: '2026-08-05', endTime: '2026-08-05', page: 1, pageSize: 50 });
  assert.ok(expr.includes('kf.jd.com'));
  assert.ok(expr.includes('credentials'));
});
