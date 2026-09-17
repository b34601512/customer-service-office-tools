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

test('selfCheck：建议话术收尾问「需要吗」判 fail，收尾逼单句带 closer 才 ok', () => {
  const rv = JSON.parse(JSON.stringify(review));
  rv.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><div class="compare"><div class="col good"><p>这款带雾化更适合老人。<b>需要吗？</b></p></div></div></div></details>';
  const htmlOpen = '<html><style>.from-kf{}.from-cus{} .cid{display:none}</style>body.show-cid .cid{display:inline}<button class="cid-toggle"></button><details class="insight" id="r1"><summary><span class="sum-main">x</span><span class="sum-btn"></span></summary><div class="insight-body"><div class="compare"><div class="col good"><p>需要吗？</p></div></div></div></details></html>';
  const itemsOpen = runSelfCheck(htmlOpen, { review: rv, report: { imageFailures: [] }, chat });
  assert.strictEqual(itemsOpen.find((x) => x.text.includes('开放式问句')).status, 'fail');

  const rvOk = JSON.parse(JSON.stringify(rv));
  rvOk.insights.r1 = rvOk.insights.r1.replace('<b>需要吗？</b>', '<b class="closer">您现在下单，我帮您把赠品备注好～</b>');
  const htmlOk = htmlOpen.replace('需要吗？', '您现在下单，我帮您把赠品备注好～').replace('<div class="col good">', '<div class="col good"><b class="closer"></b>');
  const itemsOk = runSelfCheck(htmlOk, { review: rvOk, report: { imageFailures: [] }, chat });
  assert.strictEqual(itemsOk.find((x) => x.text.includes('开放式问句')).status, 'ok');
  assert.strictEqual(itemsOk.find((x) => x.text.includes('逼单收尾句已高亮')).status, 'ok');

  // 引号里提到“需要吗”是在讲规则，不算违规（否则教学要点会被误伤）
  const rvQuoted = JSON.parse(JSON.stringify(rv));
  rvQuoted.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><ul class="tips"><li><span>收尾别说“需要吗”，改成：<b class="closer">您现在下单，我帮您备注好赠品~</b></span></li></ul></div></details>';
  const itemsQuoted = runSelfCheck(htmlOpen, { review: rvQuoted, report: { imageFailures: [] }, chat });
  assert.strictEqual(itemsQuoted.find((x) => x.text.includes('开放式问句')).status, 'ok');
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

test('定稿版式（美化版）关键样式还在：白底解析卡/绿色按钮/.closer 高亮', async () => {
  const rv = JSON.parse(JSON.stringify(review));
  rv.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><div class="compare"><div class="col good"><p>好的 <b class="closer">您现在下单，我帮您备注好赠品~</b></p></div></div></div></details>';
  const { html } = await renderCourseware(chat, rv);
  assert.ok(/\.closer\{/.test(html), '逼单收尾高亮样式要还在');
  assert.ok(/#16a34a/.test(html), '绿色按钮主色要还在');
  assert.ok(/\.sum-btn\{/.test(html), '展开按钮样式要还在');
  assert.ok(/\.insight\{/.test(html), '解析卡样式要还在');
  assert.ok(!/class="header"/.test(html), '不能把废弃的顶部大标题加回来');
});

test('overlay.textOverride 只改展示文本、不动聊天记录原文', async () => {
  const rv = JSON.parse(JSON.stringify(review));
  rv.overlays = [{ i: 1, textOverride: 'https://item.jd.com/100035703597.html' }];
  const { html } = await renderCourseware(chat, rv);
  assert.ok(html.includes('https://item.jd.com/100035703597.html'), '改写后的文本要渲染');
  assert.ok(!html.includes('现在是涨价了哦'), '原文不应再出现在页面上');
  assert.strictEqual(chat.messages[1].text, '现在是涨价了哦', '聊天记录原文不能被修改');
});
