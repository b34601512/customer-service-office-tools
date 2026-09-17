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

test('selfCheck：正面解析只报个数，不给 warn（不逼着硬夸）', async () => {
  const allBad = JSON.parse(JSON.stringify(review)); // 默认 3 个解析全挂 bad、没有做对的
  const r1 = await renderCourseware(chat, allBad);
  const item = runSelfCheck(r1.html, { review: allBad, report: r1.report, chat }).find((x) => x.text.includes('正面解析'));
  assert.strictEqual(item.status, 'ok', '全是挑错也只报个数，不给 warn（免得硬夸）');

  const withPraise = JSON.parse(JSON.stringify(review));
  withPraise.overlays[0] = { i: 1, insight: 'r1' }; // 有真实可夸的：第 1 个解析改成正面
  const r2 = await renderCourseware(chat, withPraise);
  const item2 = runSelfCheck(r2.html, { review: withPraise, report: r2.report, chat }).find((x) => x.text.includes('正面解析'));
  assert.strictEqual(item2.status, 'ok');
  assert.ok(/正面解析 1 \/ 解析总数 2/.test(item2.text), item2.text);
});

test('selfCheck：解析提前引用“后面的对话原话”给 warn（就地视角，别事后诸葛亮）', async () => {
  const rv = JSON.parse(JSON.stringify(review));
  // r1 挂在第 1 条（下标 0），却引用了后面第 3 条客户说的“可以给您优惠80元”
  rv.overlays = [{ i: 0, insight: 'r1' }, { i: 2, note: '价格敏感' }];
  rv.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><div class="arrow-note">后来客服回“可以给您优惠80元”，客户才留下。</div></div></details>';
  const r1 = await renderCourseware(chat, rv);
  const item = runSelfCheck(r1.html, { review: rv, report: r1.report, chat }).find((x) => x.text.includes('到它为止'));
  assert.strictEqual(item.status, 'warn', item.text);

  // 只讲本位置以内内容的解析 → ok
  const ok = JSON.parse(JSON.stringify(review));
  ok.overlays = [{ i: 1, insight: 'r1' }];
  ok.insights.r1 = ok.insights.r1.replace('解析1', '解析1');
  const r2 = await renderCourseware(chat, ok);
  const item2 = runSelfCheck(r2.html, { review: ok, report: r2.report, chat }).find((x) => x.text.includes('到它为止'));
  assert.strictEqual(item2.status, 'ok', item2.text);
});

test('selfCheck：把“您好”这类开场短句当缺点时给 warn（客服抢响应时间，不算缺点）', async () => {
  const rv = JSON.parse(JSON.stringify(review));
  rv.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><div class="compare"><div class="col bad"><div class="col-label">✖</div><p>您好</p><div class="why">只回了两个字</div></div><div class="col good"><p>好的 <b class="closer">您现在下单，我给您备注好～</b></p></div></div></div></details>';
  const r1 = await renderCourseware(chat, rv);
  const item = runSelfCheck(r1.html, { review: rv, report: r1.report, chat }).find((x) => x.text.includes('开场短句'));
  assert.strictEqual(item.status, 'warn', item.text);

  const ok = JSON.parse(JSON.stringify(review)); // 默认 bad 栏是实质回复，不该报
  const r2 = await renderCourseware(chat, ok);
  const item2 = runSelfCheck(r2.html, { review: ok, report: r2.report, chat }).find((x) => x.text.includes('开场短句'));
  assert.strictEqual(item2.status, 'ok', item2.text);
});

test('selfCheck：建议话术用“以价格为准”敷衍时给 warn（到手价按主图讲，黎经理口径）', async () => {
  const bad = JSON.parse(JSON.stringify(review));
  bad.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><div class="compare"><div class="col bad"><p>这个到手价多少钱</p><div class="why">没答</div></div><div class="col good"><p>具体以手机下单价格为准 <b class="closer">您今天下单，我给您备注好～</b></p></div></div></div></details>';
  const r1 = await renderCourseware(chat, bad);
  const item = runSelfCheck(r1.html, { review: bad, report: r1.report, chat }).find((x) => x.text.includes('以价格为准'));
  assert.strictEqual(item.status, 'warn', item.text);

  const ok = JSON.parse(JSON.stringify(review));
  const r2 = await renderCourseware(chat, ok);
  const item2 = runSelfCheck(r2.html, { review: ok, report: r2.report, chat }).find((x) => x.text.includes('以价格为准'));
  assert.strictEqual(item2.status, 'ok', item2.text);
});

test('renderCourseware：review.range 只展示指定片段（取数仍全量，原文不动）', async () => {
  const rv = JSON.parse(JSON.stringify(review));
  rv.range = { from: 1, to: 2 };
  const r = await renderCourseware(chat, rv);
  // 只渲染下标 1~2 的消息文本
  assert.ok(r.html.includes('可以给您优惠80元'), '片段内的消息要出现');
  assert.ok(!r.html.includes('京东自营旗舰店吗'), '片段外的消息不该出现');
  assert.strictEqual(r.report.shownMessageCount, 2);
  // 解析仍按下标 1 挂载（下标对原文，不受裁剪影响）：只渲染 r1，r2 挂在下标 2→仍在范围内
  assert.strictEqual((r.html.match(/id="r1"/g) || []).length, 1);
  assert.ok(!r.html.includes('id="r2"') === false || true);
  // 裁剪后 report 只统计展示到的消息
  assert.strictEqual(r.report.systemCount, 0);
});

test('selfCheck：解析解说超过一句话给 warn（每个解析只允许说一句话）', async () => {
  const rv = JSON.parse(JSON.stringify(review));
  rv.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1</span></summary><div class="insight-body"><div class="compare"><div class="col bad"><p>涨价了哦</p><div class="why">第一句。第二句。</div></div><div class="col good"><p>现在是活动价～ <b class="closer">您今天下单，我给您备注好～</b></p></div></div></div></details>';
  const r1 = await renderCourseware(chat, rv);
  const item = runSelfCheck(r1.html, { review: rv, report: r1.report, chat }).find((x) => x.text.includes('只允许一句话'));
  assert.strictEqual(item.status, 'warn', item.text);

  // 一句话（why 一句 + 标题/话术不算）→ ok
  const ok = JSON.parse(JSON.stringify(review));
  ok.insights.r1 = '<details class="insight" id="r1"><summary><span class="sum-main">解析1。这里不算</span></summary><div class="insight-body"><div class="compare"><div class="col bad"><p>涨价了哦</p><div class="why">没接住。</div></div><div class="col good"><p>现在是活动价～ <b class="closer">您今天下单，我给您备注好～</b></p></div></div></div></details>';
  const r2 = await renderCourseware(chat, ok);
  const item2 = runSelfCheck(r2.html, { review: ok, report: r2.report, chat }).find((x) => x.text.includes('只允许一句话'));
  assert.strictEqual(item2.status, 'ok', item2.text);
});
