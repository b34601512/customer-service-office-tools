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
  assert.ok(!html.includes('class="header"'));
  assert.ok(html.includes('<title>培训课件：'));
  assert.ok(!html.includes(review.sub), '案例看点摘要不应再渲染进页面');
  assert.strictEqual((html.match(/<details class="insight"/g) || []).length, 2);
  assert.strictEqual((html.match(/class="sum-btn"/g) || []).length, 2, '每个解析块都要有统一的展开按钮');
  assert.ok(html.includes('点击展开解析'));
  assert.ok(html.includes('点击收起'));
  assert.strictEqual(report.messageCount, 3);
  assert.strictEqual(report.monthDir, '2026年8月');
});

test('selfCheck 全绿（无图片）', async () => {
  const { html, report } = await renderCourseware(chat, review);
  const items = runSelfCheck(html, { review, report, chat });
  const s = summarize(items);
  assert.strictEqual(s.fail, 0);
  assert.strictEqual(s.ok, items.length - s.warn);
});

test('旧解析文件里的 sum-hint 被按钮替代，且按钮不重复', async () => {
  const legacy = JSON.parse(JSON.stringify(review));
  legacy.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span><span class="sum-hint">点击展开</span></summary><div class="insight-body">当时 vs 建议</div></details>';
  const { html } = await renderCourseware(chat, legacy);
  assert.ok(!html.includes('class="sum-hint"'), '旧文字提示应被去掉');
  assert.strictEqual((html.match(/class="sum-btn"/g) || []).length, 2);
  assert.strictEqual((html.match(/<span class="t-open">点击展开解析<\/span>/g) || []).length, 2);
});

test('selfCheck：解析块缺按钮判 fail', () => {
  const bare = '<html><style>.from-kf{}.from-cus{}</style>.cid{display:none}body.show-cid .cid{display:inline}<button class="cid-toggle"></button><details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body">x</div></details></html>';
  const items = runSelfCheck(bare, { review, report: { imageFailures: [] }, chat });
  const item = items.find((x) => x.text.includes('显而易见的「点击展开」按钮'));
  assert.strictEqual(item.status, 'fail');
});

test('图片下载失败进入报告且自检警告', async () => {
  const chatImg = JSON.parse(JSON.stringify(chat));
  chatImg.messages[0].img = 'http://127.0.0.1:1/nope.png';
  const { html, report } = await renderCourseware(chatImg, review);
  assert.strictEqual(report.imageFailures.length, 1);
  const items = runSelfCheck(html, { review, report, chat: chatImg });
  assert.ok(items.some((x) => x.status === 'warn' && x.text.includes('图片下载')));
});

test('系统消息（机器人自动回复）必须画出来且自检通过', async () => {
  const chatSys = JSON.parse(JSON.stringify(chat));
  chatSys.meta.sourceNote = '京东咚咚全量记录 sid=x（含机器人自动回复/系统消息）';
  chatSys.messages.splice(1, 0, { time: '2026-08-05 15:07:40', role: 'system', label: '自动回复', text: '亲亲～帮您查一下哦～' });
  const { html, report } = await renderCourseware(chatSys, review);
  assert.ok(html.includes('class="msg from-sys"'));
  assert.ok(html.includes('自动回复'));
  assert.ok(html.includes('灰色虚线框'));
  assert.strictEqual(report.systemCount, 1);
  const items = runSelfCheck(html, { review, report, chat: chatSys });
  const sysItem = items.find((x) => x.text.includes('机器人/系统消息'));
  assert.strictEqual(sysItem.status, 'ok');
  assert.strictEqual(summarize(items).fail, 0);
});

test('旧口径（无机器人消息且非全量来源）自检给出提醒', async () => {
  const { html, report } = await renderCourseware(chat, review);
  const items = runSelfCheck(html, { review, report, chat });
  const sysItem = items.find((x) => x.text.includes('取数疑似旧口径'));
  assert.strictEqual(sysItem.status, 'warn');
});
