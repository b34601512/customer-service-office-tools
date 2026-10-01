// 跟读收件箱：摘要必须给出「时间/单聊群聊/类型/正文」，且**不许出现内部 ID**（userid/chat_id/msgid）；
// 读新字节必须只读完整行（半行留到下轮），文件轮转要能自愈。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { 读新字节, 摘要行, 取参数, 默认收件箱 } = require('../scripts/跟读收件箱.cjs');

test('摘要行：单聊文本 → 时间 + 单聊 + 正文，且不泄露内部 ID', () => {
  const 行 = JSON.stringify({
    at: '2026-10-01 09:03:10',
    msgid: 'm-1', chattype: 'single', chatid: '', fromUserId: 'wo**********************_ilFdnEg',
    kind: 'text', msgtype: 'text', text: '帮我登记发票', note: '', quoteText: '', media: null
  });
  const 摘要 = 摘要行(行);
  assert.match(摘要, /^【新消息】09:03 单聊\[text\] 帮我登记发票$/);
  assert.doesNotMatch(摘要, /woFqtuEQ|m-1/); // 反向锁：内部 ID 不许打印
});

test('摘要行：群聊带引用与附件 → 标出（含引用）/（附件已存）', () => {
  const 行 = JSON.stringify({
    at: '2026-10-01 15:00:00', msgid: 'm-2', chattype: 'group', chatid: 'chat-x',
    fromUserId: 'u', kind: 'mixed', msgtype: 'mixed',
    text: '图里这个\n价格不对', note: '图文混排', quoteText: '昨天的报价单', mediaPath: 'D:/x/a.jpg'
  });
  const 摘要 = 摘要行(行);
  assert.match(摘要, /15:00 群聊\[mixed\]（含引用） 图里这个 价格不对（附件已存 \.state\/media）$/);
  assert.doesNotMatch(摘要, /chat-x|m-2/);
});

test('摘要行：坏行兜底，不抛错', () => {
  assert.match(摘要行('{坏 JSON'), /读不出来/);
});

test('取参数：--从头 与 --文件 都能解析', () => {
  assert.deepEqual(取参数([]), { 从头: false, 文件: 默认收件箱 });
  assert.equal(取参数(['--从头']).从头, true);
  assert.equal(取参数(['--文件', 'D:/tmp/x.jsonl']).文件, 'D:/tmp/x.jsonl');
  assert.equal(取参数(['--文件']).文件, 默认收件箱); // 缺值回落默认
});

test('读新字节：只读完整行，写到一半的行留到下一轮', () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '跟读-'));
  const 文件 = path.join(目录, 'inbox.jsonl');
  fs.writeFileSync(文件, '第一行\n第二', 'utf8');
  const 一 = 读新字节(文件, 0);
  assert.deepEqual(一.行, ['第一行']);                      // 半行不读
  assert.equal(一.偏移, Buffer.byteLength('第一行\n', 'utf8'));
  fs.appendFileSync(文件, '行\n第三行\n', 'utf8');
  const 二 = 读新字节(文件, 一.偏移);
  assert.deepEqual(二.行, ['第二行', '第三行']);            // 续上，且不漏
  const 三 = 读新字节(文件, 二.偏移);
  assert.deepEqual(三.行, []);                              // 没有新内容就安静
  fs.rmSync(目录, { recursive: true, force: true });
});

test('读新字节：文件被清空/轮转 → 偏移自愈从头读', () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '跟读-'));
  const 文件 = path.join(目录, 'inbox.jsonl');
  fs.writeFileSync(文件, '旧旧旧旧旧\n', 'utf8');
  const 尾 = fs.statSync(文件).size;
  fs.writeFileSync(文件, '新\n', 'utf8');                   // 文件变小
  const 结果 = 读新字节(文件, 尾);
  assert.deepEqual(结果.行, ['新']);
  fs.rmSync(目录, { recursive: true, force: true });
});
