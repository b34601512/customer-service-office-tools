const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const 金山表 = require('./index.js');

/** 跑一段会打印的命令行逻辑，但把 stdout 收起来（返回收集到的输出） */
async function 静默(fn) {
  const 原文 = console.log;
  const 行 = [];
  console.log = (...args) => 行.push(args.join(' '));
  try {
    const 结果 = await fn();
    return { 结果, 输出: 行.join('\n') };
  } finally {
    console.log = 原文;
  }
}

function 临时项目(配置) {
  const 根 = fs.mkdtempSync(path.join(os.tmpdir(), 'kdocs-'));
  if (配置) {
    fs.mkdirSync(path.join(根, 'project-config'), { recursive: true });
    fs.writeFileSync(path.join(根, 'project-config', 'kdocs-airscript.json'), JSON.stringify(配置), 'utf8');
  }
  return 根;
}

test('读表核心：没注入 chromium 就直接报错（避免壳里忘注入）', () => {
  assert.throws(() => 金山表.创建读表核心({}), /需要传 chromium/);
  const 核心 = 金山表.创建读表核心({ chromium: {} });
  assert.deepEqual(Object.keys(核心).sort(), ['listSheets', 'readSheet', 'readSheets', 'resolveBrowserPath']);
});

test('脚本客户端：没传项目根报错；缺配置报错（不猜）', () => {
  assert.throws(() => 金山表.创建脚本客户端({}), /需要传 项目根/);
  const 客户端 = 金山表.创建脚本客户端({ 项目根: 临时项目(null) });
  assert.throws(() => 客户端.readAirScriptConfig(), /缺少金山脚本配置/);
});

test('脚本客户端：从本项目 project-config 读 webhook 与令牌；脚本名不在配置里要报清楚', () => {
  const 根 = 临时项目({ apiToken: 'FAKE-TOKEN', scripts: { query: { webhookUrl: 'https://example.invalid/query' }, filterPendingRefund: { webhookUrl: 'https://example.invalid/filter' } } });
  const 客户端 = 金山表.创建脚本客户端({ 项目根: 根 });
  const 配置 = 客户端.readAirScriptConfig();
  assert.equal(配置.apiToken, 'FAKE-TOKEN');
  assert.equal(客户端.resolveWebhook('filterPendingRefund', 配置), 'https://example.invalid/filter');
  assert.throws(() => 客户端.resolveWebhook('不存在的脚本', 配置), /配置里没有脚本「不存在的脚本」的 webhook/);
});

test('脚本客户端：本机缺令牌时沿用 12号 那份（fallback 相对本项目根）', () => {
  const 根 = 临时项目({ scripts: { query: { webhookUrl: 'https://example.invalid/query' } } });
  const 十二 = path.join(根, '..', '12.店铺指标数据自动更新', 'project-config');
  fs.mkdirSync(十二, { recursive: true });
  fs.writeFileSync(path.join(十二, 'platform-config.json'), JSON.stringify({ kdocsDataSourceSync: { apiToken: 'FROM-12' } }), 'utf8');
  try {
    const 客户端 = 金山表.创建脚本客户端({ 项目根: 根 });
    assert.equal(客户端.readAirScriptConfig().apiToken, 'FROM-12');
  } finally {
    fs.rmSync(path.join(根, '..', '12.店铺指标数据自动更新'), { recursive: true, force: true });
  }
});

test('读表命令行：--list 列工作表；没给 --sheet 时退出码 2（不猜）', async () => {
  const 读表 = {
    listSheets: async () => ['退货退款表', '异常件'],
    readSheets: async () => ({}),
    readSheet: async () => ({ matrix: [], sheetName: '', sheetNames: [], rowCount: 0, columnCount: 0 }),
  };
  const 项目根 = 临时项目(null);
  const 列 = await 静默(() => 金山表.跑读表命令行({ argv: ['--list'], 项目根, 读表, 预算: 0 }));
  assert.match(列.输出, /退货退款表/);
  assert.equal(列.结果.exitCode, 0);

  const 缺 = await 静默(() => 金山表.跑读表命令行({ argv: [], 项目根, 读表 }));
  assert.equal(缺.结果.exitCode, 2);
});

test('读表命令行：--all 跨表搜关键字 + 按 {sheet} 导出 JSON', async () => {
  const 读表 = {
    listSheets: async () => ['退货退款表', '异常件'],
    readSheets: async () => ({
      退货退款表: { matrix: [['订单号', '状态'], ['123', '已退款']], rowCount: 2, columnCount: 2 },
      异常件: { matrix: [['订单号'], ['999']], rowCount: 2, columnCount: 1 },
    }),
    readSheet: async () => { throw new Error('不该走单表读取'); },
  };
  const 项目根 = 临时项目(null);
  const { 结果, 输出 } = await 静默(() => 金山表.跑读表命令行({
    argv: ['--all', '--grep', '999', '--out', 'runtime/kdocs/{sheet}.json'], 项目根, 读表,
  }));
  assert.equal(结果.exitCode, 0);
  assert.match(输出, /★ 工作表「异常件」命中 1 行/);
  assert.ok(fs.existsSync(path.join(项目根, 'runtime', 'kdocs', '异常件.json')));
  assert.ok(fs.existsSync(path.join(项目根, 'runtime', 'kdocs', '退货退款表.json')));
});

test('查询命令行：关键词自动拆批、结果按「表#行」去重、导出 JSON', async () => {
  let 调用 = 0;
  const runAirScript = async ({ keywords }) => {
    调用 += 1;
    return {
      scriptVersion: 'v9', matchCount: 1, checkedSheets: 2, scannedRows: 10,
      keywords, sheetDetails: [{ sheet: '退货退款表', hits: 1, rows: 10 }],
      matches: [{ sheet: '退货退款表', row: 5, values: ['a'] }],
    };
  };
  const 项目根 = 临时项目(null);
  const { 结果, 输出 } = await 静默(() => 金山表.跑查询命令行({
    argv: ['1', '2', '3', '4', '5', '--batch-size', '2', '--out', 'runtime/kdocs/query-<关键词>.json'],
    项目根, runAirScript,
  }));
  assert.equal(结果.exitCode, 0);
  assert.equal(调用, 3, '5 个关键词按每批 2 个应拆成 3 批');
  assert.match(输出, /命中合计：1 行/, '三批返回同一行，合并后应去重成 1 行');
  const 落盘 = path.join(项目根, 'runtime', 'kdocs', 'query-1.json');
  assert.ok(fs.existsSync(落盘));
  assert.equal(JSON.parse(fs.readFileSync(落盘, 'utf8')).batches, 3);

  const 缺 = await 静默(() => 金山表.跑查询命令行({ argv: [], 项目根, runAirScript }));
  assert.equal(缺.结果.exitCode, 2);
});

test('筛选命令行：只出清单、落盘默认文件，不发送任何消息', async () => {
  const runAirScript = async (options, meta) => {
    assert.equal(meta.script, 'filterPendingRefund');
    return {
      scriptVersion: 'v3', sheetName: '退货退款表', columnIndexes: { status: 22 }, header: ['订单号', '状态'],
      summary: { scannedRows: 100, rowsWithOrder: 40, pendingCount: 2, statusCounts: { 已退款: 38, '': 2 } },
      samples: [{ row: 7, platform: 'PDD', customer: '张三', orderId: 'X', status: '', refundAmount: '10', refundTime: '' }],
    };
  };
  const 项目根 = 临时项目(null);
  const { 结果, 输出 } = await 静默(() => 金山表.跑筛选命令行({ argv: [], 项目根, runAirScript }));
  assert.equal(结果.exitCode, 0);
  assert.match(输出, /本工具只出清单，不发消息/);
  assert.ok(fs.existsSync(path.join(项目根, 'runtime', 'kdocs', '待提醒-未退款.json')));
});

test('反向断言：22/24/25 号的金山相关文件只能是薄壳（不许再自带实现）', () => {
  const 壳 = [
    '22.后台售后服务单分析/src/engine/kdocs.js',
    '22.后台售后服务单分析/src/engine/kdocsAirScript.js',
    '22.后台售后服务单分析/src/tools/read-kdocs.js',
    '22.后台售后服务单分析/src/tools/kdocs-query.js',
    '22.后台售后服务单分析/src/tools/kdocs-filter.js',
    '24.平台退款复查/src/engine/kdocs.js',
    '24.平台退款复查/src/engine/kdocsAirScript.js',
    '24.平台退款复查/src/tools/read-kdocs.js',
    '24.平台退款复查/src/tools/kdocs-query.js',
    '24.平台退款复查/src/tools/kdocs-filter.js',
    '25.京东换货登记核查/src/engine/kdocs.js',
    '25.京东换货登记核查/src/engine/kdocsAirScript.js',
    '25.京东换货登记核查/src/tools/read-kdocs.js',
    '25.京东换货登记核查/src/tools/kdocs-query.js',
  ];
  const 根 = path.join(__dirname, '..', '..');
  for (const f of 壳) {
    const 源 = fs.readFileSync(path.join(根, f), 'utf8');
    assert.ok(/tools\/金山表/.test(源), `${f} 应 require 共享库`);
    assert.ok(!/page\.evaluate\(/.test(源), `${f} 里还在自己读金山页面，应调用共享库`);
    assert.ok(!/chromium\.launch\(/.test(源), `${f} 里还在自己拉浏览器，应调用共享库`);
    assert.ok(!/["'`]AirScript-Token["'`]/.test(源), `${f} 里还在自己拼 AirScript 请求，应调用共享库`);
    assert.ok(!/splitBatches|statusCounts/.test(源), `${f} 里还在自己实现 CLI 逻辑，应调用共享库`);
  }
});
