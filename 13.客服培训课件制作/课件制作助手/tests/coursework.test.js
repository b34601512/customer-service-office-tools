const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createWorkspace } = require('../src/services/paths');
const { writeChat, reviewFileFor } = require('../src/services/chatStore');
const { makeChat } = require('../src/services/chatSchema');
const { generateCourseware } = require('../src/services/courseworkService');

function makeChatFixture() {
  return makeChat({ platform: 'manual', meta: { window: '2026-08-05', customer: 'jd_abc' }, messages: [
    { time: '2026-08-05 15:00:00', role: 'customer', text: '怎么涨价了' },
    { time: '2026-08-05 15:00:05', role: 'waiter', text: '现在是涨价了哦' }
  ] });
}

function tmpWs() {
  return createWorkspace(fs.mkdtempSync(path.join(os.tmpdir(), 'cj-cw-')));
}

function putReview(ws, chatFile, review) {
  const rel = reviewFileFor(ws, chatFile);
  fs.mkdirSync(path.dirname(rel.file), { recursive: true });
  fs.writeFileSync(rel.file, JSON.stringify(review, null, 2), 'utf8');
  return rel.file;
}

test('无解析文件 → needReview 并生成空白模板', async () => {
  const ws = tmpWs();
  const { fileName } = writeChat(ws, makeChatFixture());
  const r = await generateCourseware(ws, { chatFile: fileName });
  assert.strictEqual(r.status, 'needReview');
  assert.ok(fs.existsSync(r.reviewPath));
});

test('解析文件校验失败 → invalid', async () => {
  const ws = tmpWs();
  const { fileName } = writeChat(ws, makeChatFixture());
  putReview(ws, fileName, {
    format: 'courseware-review/1', title: 't', sub: '', tagline: '', window: '2026-08-05', outputName: 'x.html',
    overlays: [{ i: 99, bad: true, insight: 'a' }],
    insights: { a: '<details class="insight"><summary>s</summary><div class="insight-body">b</div></details>' }
  });
  const r = await generateCourseware(ws, { chatFile: fileName });
  assert.strictEqual(r.status, 'invalid');
  assert.ok(r.errors.some((e) => e.includes('越界')));
});

test('正常生成 → ok 且输出 HTML + 自检全绿', async () => {
  const ws = tmpWs();
  const { fileName } = writeChat(ws, makeChatFixture());
  putReview(ws, fileName, {
    format: 'courseware-review/1',
    title: '涨价应对', sub: '', tagline: '客服培训', window: '2026-08-05', store: '',
    outputName: '涨价应对.html',
    overlays: [{ i: 1, bad: true, insight: 'r1' }],
    insights: { r1: '<details class="insight" id="r1"><summary><span class="sum-main">x</span></summary><div class="insight-body">y</div></details>' }
  });
  const r = await generateCourseware(ws, { chatFile: fileName });
  assert.strictEqual(r.status, 'ok');
  assert.ok(fs.existsSync(r.htmlPath));
  assert.ok(r.htmlPath.includes('2026年8月'));
  assert.strictEqual(r.checkItems.filter((x) => x.status === 'fail').length, 0);
});
