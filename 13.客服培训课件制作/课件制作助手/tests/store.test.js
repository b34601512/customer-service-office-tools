const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createWorkspace } = require('../src/services/paths');
const { writeChat, readChat, listChatFiles, reviewFileFor } = require('../src/services/chatStore');
const { makeChat } = require('../src/services/chatSchema');

function tmpWs() {
  return createWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-ws-')));
}

test('chatStore 写读回环 + 命名 + 解析文件路径', () => {
  const ws = tmpWs();
  const chat = makeChat({ platform: 'manual', meta: { window: '2026-08-05', customer: 'jd_abc' }, messages: [
    { time: '2026-08-05 10:00:00', role: 'customer', text: 'hi' }
  ] });
  const { fileName } = writeChat(ws, chat);
  assert.ok(fileName.includes('2026-08-05'));
  assert.ok(fileName.includes('jd_abc'));
  assert.strictEqual(listChatFiles(ws).length, 1);
  const back = readChat(ws, fileName);
  assert.strictEqual(back.messages.length, 1);
  const rel = reviewFileFor(ws, fileName);
  assert.ok(rel.file.endsWith('.review.json'));
  assert.ok(rel.file.includes('jd_abc'));
});
