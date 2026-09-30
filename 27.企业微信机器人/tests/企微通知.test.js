const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const 共享 = require('../src/企微通知.cjs');

function 临时配置(内容) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wecom-notify-')), 'wecom-notify.json');
  fs.writeFileSync(p, JSON.stringify(内容), 'utf8');
  return p;
}

const 假地址 = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=FAKEKEY';
const 假响应 = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test('解析参数：--file/--text/--at 多个名字/--send', () => {
  assert.deepEqual(共享.解析参数(['--text', 'hi', '--send']), { at: [], text: 'hi', send: true });
  assert.deepEqual(共享.解析参数(['--file', 'a.txt', '--at', '张三', '李四', '--send']), { at: ['张三', '李四'], file: 'a.txt', send: true });
});

test('读配置：缺文件/缺 webhookUrl 都报错（不猜）', () => {
  assert.throws(() => 共享.读配置(path.join(os.tmpdir(), '不存在的-wecom.json')), /缺少通知配置/);
  assert.throws(() => 共享.读配置(临时配置({ members: {} })), /没有 webhookUrl/);
});

test('解析提及：没配手机号就报错；配了就返回手机号', () => {
  assert.throws(() => 共享.解析提及(['王五'], { members: {} }), /没有「王五」的手机号/);
  assert.deepEqual(共享.解析提及(['张三', '李四'], { members: { 张三: '13800000001', 李四: '13800000002' } }), ['13800000001', '13800000002']);
});

test('检查文本：空内容/超 2048 字节都要拦下', () => {
  assert.throws(() => 共享.检查文本('   '), /没有消息内容/);
  const 超 = '字'.repeat(700); // 2100 字节
  assert.throws(() => 共享.检查文本(超), /超过企微上限 2048/);
  assert.deepEqual(共享.检查文本('两行\n内容').lines, 2);
});

test('预演不发：不加 --send 时一次 fetch 都不会发出去', async () => {
  const 配置路径 = 临时配置({ webhookUrl: 假地址, members: { 张三: '13800000001' } });
  let 调用了 = 0;
  const r = await 共享.跑命令行({
    配置路径, argv: ['--text', '预演内容', '--at', '张三'], 日志: () => {},
    fetchImpl: async () => { 调用了 += 1; return 假响应({ errcode: 0 }); },
  });
  assert.equal(调用了, 0);
  assert.equal(r.sent, false);
  assert.deepEqual(r.at, ['张三']);
});

test('--send 才真发；errcode≠0 抛错（附原文）', async () => {
  const 配置路径 = 临时配置({ webhookUrl: 假地址, members: {} });
  let 收到 = null;
  const ok = await 共享.跑命令行({
    配置路径, argv: ['--text', '真发内容', '--send'], 日志: () => {},
    fetchImpl: async (url, init) => { 收到 = { url, body: JSON.parse(init.body) }; return 假响应({ errcode: 0 }); },
  });
  assert.equal(ok.sent, true);
  assert.equal(收到.body.msgtype, 'text');
  assert.equal(收到.body.text.content, '真发内容');
  assert.equal(收到.body.text.mentioned_mobile_list, undefined);

  await assert.rejects(() => 共享.跑命令行({
    配置路径, argv: ['--text', 'x', '--send'], 日志: () => {},
    fetchImpl: async () => 假响应({ errcode: 93000, errmsg: 'invalid webhook url' }),
  }), /errcode=93000/);
});

test('校验机器人地址：只允许企微官方主机+路径，且必须有 key', () => {
  assert.ok(共享.校验机器人地址(假地址));
  assert.throws(() => 共享.校验机器人地址('https://evil.example.com/cgi-bin/webhook/send?key=x'), /已拒绝/);
  assert.throws(() => 共享.校验机器人地址('https://qyapi.weixin.qq.com/other?key=x'), /已拒绝/);
  assert.throws(() => 共享.校验机器人地址('https://qyapi.weixin.qq.com/cgi-bin/webhook/send'), /缺少 key/);
  assert.throws(() => 共享.校验机器人地址('not-a-url'), /合法 URL/);
});

test('打码机器人地址：key 不泄露', () => {
  const 打码 = 共享.打码机器人地址(假地址);
  assert.ok(!打码.includes('FAKEKEY'));
  assert.ok(打码.includes('******'));
});

test('造消息体：markdown 不带 @；text 带 @；空内容拒绝', () => {
  assert.deepEqual(共享.造消息体({ 类型: 'markdown', 内容: '# 标题', 提及手机号: ['13800000000'] }), { msgtype: 'markdown', markdown: { content: '# 标题' } });
  assert.deepEqual(共享.造消息体({ 类型: 'text', 内容: '内容', 提及手机号: ['13800000000'] }), { msgtype: 'text', text: { content: '内容', mentioned_mobile_list: ['13800000000'] } });
  assert.throws(() => 共享.造消息体({ 类型: 'text', 内容: '   ' }), /内容为空/);
});

test('发一条：45009 附限频提示；只请求 1 次（不自动重试）', async () => {
  let 次数 = 0;
  await assert.rejects(() => 共享.发一条({
    webhookUrl: 假地址,
    消息体: { msgtype: 'text', text: { content: 'x' } },
    fetchImpl: async () => { 次数 += 1; return 假响应({ errcode: 45009, errmsg: 'api freq out of limit' }); },
  }), /45009.*20 条\/分钟限频/);
  assert.equal(次数, 1);
});

test('跑群机器人命令行：--help 只打印用法；--send 走 --webhook；未知参数报错', async () => {
  const 行 = [];
  const 帮助 = await 共享.跑群机器人命令行({ argv: ['--help'], 输出: (t) => 行.push(t) });
  assert.equal(帮助.sent, false);
  assert.match(行.join('\n'), /--mention/);

  let 收到 = null;
  const 发 = await 共享.跑群机器人命令行({
    argv: ['--text', '群消息', '--mention', '13800000000, 13900000000', '--webhook', 假地址, '--send'],
    fetchImpl: async (url, init) => { 收到 = JSON.parse(init.body); return 假响应({ errcode: 0 }); },
    输出: () => {},
  });
  assert.equal(发.sent, true);
  assert.deepEqual(收到.text.mentioned_mobile_list, ['13800000000', '13900000000']);

  await assert.rejects(() => 共享.跑群机器人命令行({ argv: ['--text', 'x', '--send-all'], 输出: () => {} }), /未知参数/);
});

test('反向断言：22/24/25 号的壳里不许再自带发送逻辑（只许转发到共享核心）', () => {
  const 壳 = [
    '22.后台售后服务单分析/src/tools/send-wecom-notice.js',
    '24.平台退款复查/src/tools/send-wecom-notice.js',
    '25.京东换货登记核查/src/tools/send-wecom-notice.js',
  ];
  for (const f of 壳) {
    const 全路径 = path.join(__dirname, '..', '..', f);
    const 源 = fs.readFileSync(全路径, 'utf8');
    assert.ok(!/fetch\(/.test(源), `${f} 里还在自己 fetch，应调用共享核心`);
    assert.ok(!/msgtype\s*:/.test(源), `${f} 里还在自己拼消息体，应调用共享核心`);
    assert.ok(!/mentioned_mobile_list\s*:/.test(源), `${f} 里还在自己拼 @ 列表，应调用共享核心`);
    assert.ok(/企微通知\.cjs/.test(源), `${f} 应 require 共享核心`);
  }
});
