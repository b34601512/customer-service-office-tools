// 跟读收件箱：摘要必须给出「时间/单聊群聊/类型/正文」，且**不许出现内部 ID**（userid/chat_id/msgid）；
// 读新字节必须只读完整行（半行留到下轮），文件轮转要能自愈。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { 读新字节, 摘要行, 本地时分, 取参数, 默认收件箱, 行ID, 造去重器, 启动读一遍, 已有实例在跟, 占锁 } = require('../scripts/跟读收件箱.cjs');

test('本地时分：ISO（UTC）要换算成本地时间，不能直接切末尾', () => {
  // 2026-10-01T05:31:24.272Z 在 GMT+8 就是 13:31（2026-10-01 实踩：显示成 05:31）
  assert.equal(本地时分('2026-10-01T05:31:24.272Z'), '13:31');
  assert.equal(本地时分('2026-10-01 09:03:10'), '09:03');  // 已是本地时间的照旧
  assert.equal(本地时分(''), '');
});

test('摘要行：单聊文本 → 时间 + 单聊 + 正文，且不泄露内部 ID', () => {
  const 行 = JSON.stringify({
    at: '2026-10-01 09:03:10',
    msgid: 'm-1', chattype: 'single', chatid: '', fromUserId: 'wo-fake-id-1',
    kind: 'text', msgtype: 'text', text: '帮我登记发票', note: '', quoteText: '', media: null
  });
  const 摘要 = 摘要行(行);
  assert.match(摘要, /^【新消息】09:03 单聊\[text\] 帮我登记发票$/);
  assert.doesNotMatch(摘要, /wo-fake|m-1/); // 反向锁：内部 ID 不许打印
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

test('行ID：优先 msgid；没有 msgid 用整行指纹（稳定、不泄露）', () => {
  const 有ID = JSON.stringify({ msgid: 'm-9', text: 'x' });
  assert.equal(行ID(有ID), 'm-9');
  const 无ID = JSON.stringify({ text: '没有 msgid 的一行' });
  const 指纹 = 行ID(无ID);
  assert.match(指纹, /^fp:[0-9a-f]{20}$/);
  assert.equal(行ID(无ID), 指纹); // 同一行指纹稳定
  assert.notEqual(行ID(JSON.stringify({ text: '另一行' })), 指纹);
});

test('去重器：同一 ID 只放行一次，不同 ID 照常放行', () => {
  const 表 = [];
  const 集 = new Set();
  const 记ID = 造去重器(表, 集);
  assert.equal(记ID('a'), true);
  assert.equal(记ID('a'), false); // 重播被拦
  assert.equal(记ID('b'), true);
  assert.deepEqual(表, ['a', 'b']);
});

test('启动读一遍：首次静默、续跟补打、重写不重播、断点失效不回溯、从头全打', () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '跟读游标-'));
  const 文件 = path.join(目录, 'inbox.jsonl');
  const 状态 = path.join(目录, '跟读状态.json');
  const 行 = (id, 文) => JSON.stringify({ at: '2026-10-13 18:00:00', msgid: id, chattype: 'single', kind: 'text', text: 文 });
  fs.writeFileSync(文件, 行('m1', '一') + '\n' + 行('m2', '二') + '\n', 'utf8');
  const 收 = [];
  const 输出 = (s) => 收.push(s);

  // 首次：静默从末尾起（不回溯重放旧消息）
  启动读一遍(文件, 状态, false, 输出);
  assert.deepEqual(收, []);

  // 续跟：停机期间追加的 m3 启动时补打
  fs.appendFileSync(文件, 行('m3', '三') + '\n', 'utf8');
  启动读一遍(文件, 状态, false, 输出);
  assert.deepEqual(收, ['【新消息】18:00 单聊[text] 三']);

  // 文件被整箱重写（内容一致）：游标对得上 → 不重播
  fs.writeFileSync(文件, 行('m1', '一') + '\n' + 行('m2', '二') + '\n' + 行('m3', '三') + '\n', 'utf8');
  启动读一遍(文件, 状态, false, 输出);
  assert.deepEqual(收, ['【新消息】18:00 单聊[text] 三']); // 没有新增输出

  // 文件被大改（行数缩水）：断点对不上 → 静默从末尾起，不回溯
  fs.writeFileSync(文件, 行('m9', '九') + '\n', 'utf8');
  启动读一遍(文件, 状态, false, 输出);
  assert.deepEqual(收, ['【新消息】18:00 单聊[text] 三']); // 仍无新增

  // --从头：全打一遍
  收.length = 0;
  启动读一遍(文件, 状态, true, 输出);
  assert.deepEqual(收, ['【新消息】18:00 单聊[text] 九']);

  fs.rmSync(目录, { recursive: true, force: true });
});

test('主流程冒烟：--文件 模式能跟到新行（spawn）', async () => {
  const { spawn } = require('node:child_process');
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '跟读冒烟-'));
  const 文件 = path.join(目录, 'inbox.jsonl');
  fs.writeFileSync(文件, '', 'utf8');
  const 子 = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', '跟读收件箱.cjs'), '--文件', 文件], { stdio: ['ignore', 'pipe', 'pipe'] });
  let 输出 = '';
  子.stdout.on('data', (d) => { 输出 += String(d); });
  try {
    await new Promise((r) => setTimeout(r, 500)); // 等启动
    fs.appendFileSync(文件, JSON.stringify({ at: '2026-10-13 18:30:00', msgid: 'sp1', chattype: 'single', kind: 'text', text: '冒烟' }) + '\n', 'utf8');
    const 截止 = Date.now() + 6000;
    while (Date.now() < 截止 && !输出.includes('冒烟')) await new Promise((r) => setTimeout(r, 200));
    assert.match(输出, /【新消息】18:30 单聊\[text\] 冒烟/);
    assert.doesNotMatch(输出, /sp1/); // 反向锁：内部 ID 不许打印
  } finally {
    子.kill();
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(目录, { recursive: true, force: true, maxRetries: 3 });
  }
});

// ── v3 单实例闸（2026-10-18 老板 20:19 令：挖根源，不许小修小补）──────────────
// 根因：程序启动时从不问「我是不是已经在跟了」→ 每次续窗/重启都多长一个监听，
// 旧的父进程死了也没人收。只「杀一遍」下次还会长回来，所以要用锁锁死。
// 反向断言：同类进程存在时，第二个必须**自己退出**，不是"两个都跑、靠人去杀"。

test('已有实例在跟：锁里 pid 活着 → 返回它；同一 pid 视为自己；不存在/已死 → 0', () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '跟读锁-'));
  const 锁 = path.join(目录, '跟读收件箱.pid');
  assert.equal(已有实例在跟(锁), 0);                       // 没有锁文件

  fs.writeFileSync(锁, String(process.pid), 'utf8');
  assert.equal(已有实例在跟(锁), 0);                       // 是自己 → 不挡自己

  const 别的 = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    fs.writeFileSync(锁, String(别的.pid), 'utf8');
    assert.equal(已有实例在跟(锁), 别的.pid);              // 有活着的同类 → 报它出来
  } finally {
    别的.kill();
  }

  // 进程死后，残留锁文件不该挡住下一个（这才叫自愈，不是要人删文件）
  const 截止 = Date.now() + 3000;
  while (Date.now() < 截止 && 已有实例在跟(锁) !== 0) {
    // 等子进程真正退出（kill 是异步生效的）
  }
  assert.equal(已有实例在跟(锁), 0);
  fs.rmSync(目录, { recursive: true, force: true, maxRetries: 3 });
});

test('占锁：写自己的 pid，退出清理只清自己那把锁（别人的锁不碰）', () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), '跟读锁2-'));
  const 锁 = path.join(目录, '跟读收件箱.pid');

  fs.writeFileSync(锁, '999999', 'utf8');                  // 别人的锁
  const 清锁 = 占锁(锁);
  assert.equal(fs.readFileSync(锁, 'utf8').trim(), String(process.pid));

  fs.writeFileSync(锁, '999999', 'utf8');                  // 锁被别人抢走
  清锁();
  assert.equal(fs.readFileSync(锁, 'utf8').trim(), '999999'); // 不许删别人的

  fs.writeFileSync(锁, String(process.pid), 'utf8');       // 还是自己的
  清锁();
  assert.equal(fs.existsSync(锁), false);                  // 自己的要清掉
  fs.rmSync(目录, { recursive: true, force: true, maxRetries: 3 });
});
