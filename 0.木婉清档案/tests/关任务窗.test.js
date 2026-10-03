// 关任务窗 / 开任务窗 的测试（2026-10-01 用户定「干完就关，别攒窗口」）
// 跑：node --test 0.木婉清档案/tests/关任务窗.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const 档案目录 = path.join(__dirname, '..');
const 关窗 = require(path.join(档案目录, '关任务窗.cjs'));

test('回执路径 = 任务回执/<同名文件>', () => {
  const p = 关窗.回执路径('任务/2026-10-01-探域C3.md');
  assert.strictEqual(path.basename(p), '2026-10-01-探域C3.md');
  assert.strictEqual(path.basename(path.dirname(p)), '任务回执');
});

test('登记：加 → 读 → 摘（pid 或任务名都能摘）', () => {
  const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), '关窗登记-'));
  const 文件 = path.join(临时, '任务窗.json');
  关窗.加登记({ 任务: '任务/a.md', 回执: '任务回执/a.md', pid: 111 }, 文件);
  关窗.加登记({ 任务: '任务/b.md', 回执: '任务回执/b.md', pid: 222 }, 文件);
  assert.strictEqual(关窗.读登记(文件).length, 2);
  assert.strictEqual(关窗.摘登记(111, 文件), true);
  assert.deepStrictEqual(关窗.读登记(文件).map((x) => x.pid), [222]);
  assert.strictEqual(关窗.摘登记('任务/b.md', 文件), true);
  assert.strictEqual(关窗.读登记(文件).length, 0);
  assert.strictEqual(关窗.摘登记(999, 文件), false);
  fs.rmSync(临时, { recursive: true, force: true });
});

test('解析时长：4h / 30m / 20s / 空=默认', () => {
  assert.strictEqual(关窗.解析时长('4h'), 4 * 3600 * 1000);
  assert.strictEqual(关窗.解析时长('30m'), 30 * 60 * 1000);
  assert.strictEqual(关窗.解析时长('20s'), 20 * 1000);
  assert.strictEqual(关窗.解析时长(''), 4 * 3600 * 1000);
});

test('守卫：回执落地 → 关掉窗口进程（真起一个进程试）', async () => {
  const 临时 = fs.mkdtempSync(path.join(os.tmpdir(), '关窗守卫-'));
  const 任务 = path.join(临时, '任务', '假任务.md');
  fs.mkdirSync(path.dirname(任务), { recursive: true });
  // 假装这是任务窗：起一个活 30 秒的进程
  const 子 = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const 回执 = 关窗.回执路径(任务);
  // 回执先落在别处，避免误用真目录：守卫用真实 回执路径，所以把任务文件放到真 任务/ 下太脏 → 这里直接验证「进程不在就摘登记」+「回执出现就关」
  fs.mkdirSync(path.dirname(回执), { recursive: true });
  const 已有回执 = fs.existsSync(回执);
  const 备份 = 已有回执 ? fs.readFileSync(回执) : null;
  try {
    fs.writeFileSync(回执, '测试占位');
    await new Promise((r) => setTimeout(r, 1200)); // 回执比开窗时间新 → 守卫该关窗
    关窗.守卫({ 任务, pid: 子.pid, 最久: 5000, 间隔: 200, 宽限: 100, 开窗时间: new Date(Date.now() - 60000).toISOString() });
    await new Promise((r) => setTimeout(r, 1500));
    assert.strictEqual(关窗.进程在(子.pid), false, '回执落地后守卫应把窗口进程关掉');
  } finally {
    try { 子.kill(); } catch {}
    if (备份) fs.writeFileSync(回执, 备份);
    else fs.rmSync(回执, { force: true });
    fs.rmSync(临时, { recursive: true, force: true });
  }
});

test('解析扫描输出：只留任务窗（监听窗/赵敏窗不算）', () => {
  const 文本 = [
    '111|60|13:45|node pi-coding-agent @D:\\桌面\\办公软件\\0.木婉清档案\\任务\\a.md',
    '222|259|13:10|node pi-coding-agent @D:\\桌面\\个人软件\\00.赵敏档案\\任务\\b.md',
    '444|100|13:12|node pi-coding-agent @D:\\桌面\\个人软件\\00.赵敏档案\\企微\\boot-prompt.md',
    '333|257|13:17|node pi-coding-agent',
    '',
  ].join('\r\n');
  const 出 = 关窗.解析窗口行(文本);
  assert.strictEqual(出.length, 1);
  assert.strictEqual(出[0].pid, 111);
  assert.strictEqual(出[0].内存MB, 60);
  assert.ok(出[0].任务.endsWith('a.md'));
});

test('反向断言：开任务窗必须挂守卫（别攒窗口）+ 不许自己发企微', () => {
  const 源 = fs.readFileSync(path.join(档案目录, '开任务窗.cjs'), 'utf8');
  assert.match(源, /关任务窗\.cjs/, '开任务窗必须引用关任务窗（干完就关）');
  assert.match(源, /--守/, '开任务窗必须自动挂 --守 守卫');
  assert.match(源, /加登记/, '开任务窗必须登记窗口（好查/好关）');
  assert.match(源, /\[关窗工具, '--守'/, '守卫的 ArgumentList 必须把脚本路径放第一位（2026-10-01 踩过：漏了它 → node 把 --守 当选项、守卫静默不跑）');
  assert.doesNotMatch(源, /发企微消息/, '开任务窗不许顺手发企微（只有监听窗跟用户联系）');
});
