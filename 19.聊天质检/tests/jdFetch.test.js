// evaluateOnPage 必须显式报错的反向断言：
// 历史缺陷 = 页内脚本被后台节流冻结时，CDP 超时只 ws.close()，pending Promise 永不 settle，
// 进程无输出静默退出 0。删掉的“只 close 不 reject”行为用本文件锁死，不许加回来。
const test = require('node:test');
const assert = require('node:assert');
const { evaluateOnPage } = require('../src/services/jdFetch');

const PAGE = { webSocketDebuggerUrl: 'ws://fake/devtools/page/1' };

function messageEvent(obj) {
  return new MessageEvent('message', { data: JSON.stringify(obj) });
}

/** 假调试连接：behavior 决定 open/回复/断开行为，全部异步派发贴近真实 WebSocket */
class FakeSocket extends EventTarget {
  constructor(behavior = {}) {
    super();
    this.behavior = behavior;
    this.sent = [];
    this.closeCalls = 0;
    if (behavior.open !== false) setTimeout(() => this.dispatchEvent(new Event('open')), 0);
  }

  send(data) {
    this.sent.push(data);
    const reply = this.behavior.reply;
    setTimeout(() => {
      if (reply === 'value') this.dispatchEvent(messageEvent({ id: 1, result: { result: { value: 7 } } }));
      else if (reply === 'exception') this.dispatchEvent(messageEvent({ id: 1, result: { exceptionDetails: { text: 'boom' } } }));
      else if (reply === 'protocolError') this.dispatchEvent(messageEvent({ id: 1, error: { message: 'proto fail' } }));
      else if (reply === 'close') this.dispatchEvent(new Event('close'));
      else if (reply === 'error') this.dispatchEvent(new Event('error'));
      // 'silent'：永不回复，模拟页内 JS 被冻结
    }, 0);
  }

  close() { this.closeCalls += 1; }
}

/** 守护竞速：promise 若永不 settle（静默退出的等价表现），测试必须失败而不是挂死 */
function mustSettle(promise, ms = 1000) {
  return Promise.race([
    promise.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e })),
    new Promise((r) => setTimeout(() => r({ hang: true }), ms))
  ]);
}

test('正常返回：取到 byValue 结果', async () => {
  const r = await mustSettle(evaluateOnPage(PAGE, '1+1', {
    timeoutMs: 500, createSocket: () => new FakeSocket({ reply: 'value' })
  }));
  assert.ok(!r.hang, 'evaluate 必须 settle，不许静默挂起');
  assert.ok(r.ok, r.ok ? '' : String(r.e && r.e.message));
  assert.strictEqual(r.v, 7);
});

test('页内脚本被冻结（永不回复）：必须以「页面执行超时」reject 并提示节流现场', async () => {
  const started = Date.now();
  const r = await mustSettle(evaluateOnPage(PAGE, 'sleep(9999)', {
    timeoutMs: 80, createSocket: () => new FakeSocket({ reply: 'silent' })
  }));
  assert.ok(!r.hang, '超时后必须 reject；绝不允许像历史缺陷那样静默退出');
  assert.ok(!r.ok, '应当 reject');
  assert.match(r.e.message, /页面执行超时/);
  assert.match(r.e.message, /最小化|后台|节流/);
  assert.match(r.e.message, /前台/);
  assert.ok(Date.now() - started < 1000, '应在 timeoutMs 附近报错');
});

test('连接建立失败（open 永不到来）：同样超时 reject，不许无声挂起', async () => {
  const r = await mustSettle(evaluateOnPage(PAGE, 'x', {
    timeoutMs: 80, createSocket: () => new FakeSocket({ open: false })
  }));
  assert.ok(!r.hang, 'open 等待也必须受超时保护');
  assert.ok(!r.ok);
  assert.match(r.e.message, /页面执行超时/);
});

test('结果返回前调试连接被关闭：明确 reject 而不是挂起', async () => {
  const r = await mustSettle(evaluateOnPage(PAGE, 'x', {
    timeoutMs: 500, createSocket: () => new FakeSocket({ reply: 'close' })
  }));
  assert.ok(!r.hang);
  assert.ok(!r.ok);
  assert.match(r.e.message, /被关闭/);
});

test('页内异常详情：reject 带原文', async () => {
  const r = await mustSettle(evaluateOnPage(PAGE, 'throw 1', {
    timeoutMs: 500, createSocket: () => new FakeSocket({ reply: 'exception' })
  }));
  assert.ok(!r.hang);
  assert.ok(!r.ok);
  assert.match(r.e.message, /boom/);
});

test('协议级错误：reject 带消息', async () => {
  const r = await mustSettle(evaluateOnPage(PAGE, 'x', {
    timeoutMs: 500, createSocket: () => new FakeSocket({ reply: 'protocolError' })
  }));
  assert.ok(!r.hang);
  assert.ok(!r.ok);
  assert.match(r.e.message, /proto fail/);
});

test('发送的 CDP 请求携带表达式与 awaitPromise', async () => {
  const socket = new FakeSocket({ reply: 'value' });
  await evaluateOnPage(PAGE, 'markedExpr', { timeoutMs: 500, createSocket: () => socket });
  assert.strictEqual(socket.sent.length, 1);
  const payload = JSON.parse(socket.sent[0]);
  assert.strictEqual(payload.method, 'Runtime.evaluate');
  assert.strictEqual(payload.params.expression, 'markedExpr');
  assert.strictEqual(payload.params.awaitPromise, true);
});
