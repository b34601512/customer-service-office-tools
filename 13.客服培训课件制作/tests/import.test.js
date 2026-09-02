const test = require('node:test');
const assert = require('node:assert');
const { parseImportText, importFromFile } = require('../src/services/importers');
const { makeChat, validateChat } = require('../src/services/chatSchema');

test('parseImportText：正常行、注释、缺时间复用', () => {
  const text = [
    '# 这是注释',
    '2026-08-05 15:07:34|客户|怎么涨价了',
    '2026-08-05 15:07:52|客服|您看的哪一款呢',
    '// 另一条注释',
    '15:08:04|客户|5升医用', // 缺日期，应复用上一条时间
    'bad line without pipe'
  ].join('\n');
  const { messages, errors } = parseImportText(text);
  assert.strictEqual(messages.length, 3);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(messages[0].role, 'customer');
  assert.strictEqual(messages[1].role, 'waiter');
  assert.strictEqual(messages[2].time, '2026-08-05 15:08:04'); // 仅时分 → 复用上一条日期
});

test('makeChat + validateChat 正常', () => {
  const chat = makeChat({ platform: 'manual', messages: [
    { time: '2026-08-05 15:00:00', role: 'customer', text: '你好' },
    { time: '2026-08-05 15:00:05', role: 'waiter', text: '您好' }
  ] });
  const check = validateChat(chat);
  assert.strictEqual(check.ok, true);
  assert.strictEqual(chat.meta.window, '2026-08-05');
});

test('importFromFile：京东原始 JSON 自动转换', () => {
  const os = require('os');
  const path = require('path');
  const fs = require('fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-'));
  const file = path.join(dir, 'raw.json');
  fs.writeFileSync(file, JSON.stringify({
    chatLogList: [{
      sid: 'S1', customer: 'jd_abc', waiter: 'waiter1',
      chatLogMessageList: [
        { created: '2026-08-05 10:00:02', content: '你好', waiterSend: 0 },
        { created: '2026-08-05 10:00:05', content: '您好<br/>有什么帮您', waiterSend: 1 },
        { created: '2026-08-05 10:00:08', imgUrl: 'http://x/img.png', content: '', waiterSend: 0, type: 'image' }
      ]
    }]
  }));
  const { chat, source } = importFromFile(file);
  assert.strictEqual(source, 'jd-raw');
  assert.strictEqual(chat.messages.length, 3);
  assert.strictEqual(chat.messages[1].role, 'waiter');
  assert.strictEqual(chat.messages[2].img, 'http://x/img.png');
  assert.strictEqual(chat.meta.platform || chat.platform, 'jd');
});
