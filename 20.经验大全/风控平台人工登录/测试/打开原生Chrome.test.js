// 反向断言：原生 Chrome 参数里绝不允许出现自动化痕迹（这是 2026-09-29 拼多多验证码失败坑的根因）。
const test = require('node:test');
const assert = require('node:assert');
const { 构造原生Chrome参数, 解析参数, 是风控平台地址 } = require('../打开原生Chrome.cjs');

const 样例 = { url: 'https://mms.pinduoduo.com/login/', profile: 'D:/x/pdd03/manual', port: '9337' };

test('参数含调试端口与画像目录', () => {
  const args = 构造原生Chrome参数(样例);
  assert.ok(args.includes('--remote-debugging-port=9337'), '必须有调试端口，程序要能连上去读页面');
  assert.ok(args.includes('--user-data-dir=D:/x/pdd03/manual'), '必须显式指定画像目录');
  assert.ok(args[args.length - 1] === 样例.url, '最后一个参数应为目标网址');
});

test('参数不含任何自动化开关（踩坑根因，禁止加回来）', () => {
  const args = 构造原生Chrome参数(样例).join(' ');
  for (const 禁止 of ['--enable-automation', '--headless', '--remote-debugging-pipe', '--disable-blink-features=AutomationControlled']) {
    assert.ok(!args.includes(禁止), `原生窗口不许出现 ${禁止}`);
  }
});

test('解析参数：缺 url / 缺 profile / 端口非法 都要报中文错', () => {
  assert.throws(() => 解析参数(['--profile', 'D:/x']), /缺少参数 --url/);
  assert.throws(() => 解析参数(['--url', 'https://a.com']), /缺少参数 --profile/);
  assert.throws(() => 解析参数(['--url', 'https://a.com', '--profile', 'D:/x', '--port', 'abc']), /--port 必须是数字/);
});

test('风控平台识别', () => {
  for (const url of ['https://mms.pinduoduo.com/login/', 'https://myseller.taobao.com/home.htm', 'https://fxg.jinritemai.com/', 'https://shop.jd.com/']) {
    assert.ok(是风控平台地址(url), `${url} 应识别为风控平台`);
  }
  assert.ok(!是风控平台地址('https://www.kdocs.cn/l/abc'), '金山文档不是风控平台');
  assert.ok(!是风控平台地址('http://agent.tanyuai.com/v2/agent-builder'), '探域后台不是风控平台');
});
