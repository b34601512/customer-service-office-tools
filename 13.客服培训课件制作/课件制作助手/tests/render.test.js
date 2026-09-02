const test = require('node:test');
const assert = require('node:assert');
const { renderCourseware } = require('../src/services/renderCourseware');
const { runSelfCheck, summarize } = require('../src/services/selfCheck');

const chat = {
  format: 'chat-record/1',
  platform: 'manual',
  meta: { customer: 'jd_khlzbrddblcz', window: '2026-08-05', store: 'dedakj自营' },
  messages: [
    { time: '2026-08-05 15:07:34', role: 'customer', text: '怎么涨价了' },
    { time: '2026-08-05 15:07:52', role: 'waiter', text: '现在是涨价了哦' },
    { time: '2026-08-05 15:10:47', role: 'waiter', text: '可以给您优惠80元' }
  ]
};

const review = {
  format: 'courseware-review/1',
  title: '老客户一句"怎么涨价了"，怎么接住？',
  sub: '案例看点：不直接承认涨价。',
  tagline: '客服培训 · 涨价应对',
  window: '2026-08-05',
  store: 'dedakj自营',
  outputName: '涨价应对案例演示.html',
  overlays: [
    { i: 1, bad: true, insight: 'r1' },
    { i: 2, note: '价格敏感', bad: true, insight: 'r2' }
  ],
  insights: {
    r1: '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body">当时 vs 建议</div></details>',
    r2: '<details class="insight" id="r2"><summary><span class="sum-main">解析2</span></summary><div class="insight-body">让利</div></details>'
  }
};

test('renderCourseware 输出关键结构与样式', async () => {
  const { html, report } = await renderCourseware(chat, review);
  assert.ok(html.includes('from-kf'));
  assert.ok(html.includes('from-cus'));
  assert.ok(html.includes('cid-toggle'));
  assert.ok(html.includes('.cid{display:none}'));
  assert.ok(html.includes('body.show-cid .cid{display:inline}'));
  assert.ok(html.includes('<details class="insight"'));
  assert.strictEqual((html.match(/<details class="insight"/g) || []).length, 2);
  assert.strictEqual(report.messageCount, 3);
  assert.strictEqual(report.monthDir, '2026年8月');
});

test('selfCheck 全绿（无图片）', async () => {
  const { html, report } = await renderCourseware(chat, review);
  const items = runSelfCheck(html, { review, report });
  const s = summarize(items);
  assert.strictEqual(s.fail, 0);
  assert.strictEqual(s.ok, items.length - s.warn);
});

test('图片下载失败进入报告且自检警告', async () => {
  const chatImg = JSON.parse(JSON.stringify(chat));
  chatImg.messages[0].img = 'http://127.0.0.1:1/nope.png';
  const { html, report } = await renderCourseware(chatImg, review);
  assert.strictEqual(report.imageFailures.length, 1);
  const items = runSelfCheck(html, { review, report });
  assert.ok(items.some((x) => x.status === 'warn' && x.text.includes('图片下载')));
});
