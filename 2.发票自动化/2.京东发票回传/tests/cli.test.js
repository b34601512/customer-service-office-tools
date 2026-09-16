const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function 读取项目文件(相对路径) {
  return fs.readFileSync(path.join(__dirname, '..', 相对路径), 'utf8');
}

test('CLI首页不再提供已废弃的凭证文件夹入口', () => {
  const text = 读取项目文件('src/cli/startCli.js');

  assert.doesNotMatch(text, /\.\/evidenceViewer/);
  assert.doesNotMatch(text, /标题: '凭证查看'/);
  assert.doesNotMatch(text, /打开凭证文件夹/);
  assert.doesNotMatch(text, /查看指定店铺识别凭证|打开全部店铺凭证文件夹|查看指定店铺凭证/);
});

test('2号原有催票、订单和正式回传入口仍在', () => {
  const text = 读取项目文件('src/cli/startCli.js');

  assert.match(text, /人工登录并识别指定店铺/);
  assert.match(text, /自动识别全部启用店铺/);
  assert.match(text, /查看和处理订单状态/);
  assert.match(text, /手动新增待处理订单/);
  assert.match(text, /批量标记开票成功订单/);
  assert.match(text, /批量回传待开票发票/);
});

test('CLI凭证查看模块已随截图能力一并删除', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/cli/evidenceViewer.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src/common/evidenceService.js')), false);
});

test('CLI回传结果页只显示精简结论，逐单凭证写入独立日志', () => {
  const { 输出发票回传结果 } = require('../src/cli/startCli');
  const output = [];
  const logs = [];
  const pages = [];
  输出发票回传结果({
    输出: (text) => output.push(String(text)),
    记录运行日志: (text) => logs.push(String(text)),
    终端: { 显示页面: (title) => pages.push(title) },
    报告: {
      summaryMessage: '完成',
      items: [
        { storeName: 'A店', orderNumber: '1', status: 'success' },
        { storeName: 'B店', orderNumber: '2', status: 'skipped', message: '发票缺失' },
      ],
    },
  });

  assert.equal(pages[0], '京东发票回传 · 发票回传结果');
  assert.match(output.join('\n'), /成功 1｜跳过 1｜失败 0/);
  assert.doesNotMatch(output.join('\n'), /凭证/);
  assert.match(logs.join('\n'), /\[订单\] A店｜1｜/);
  assert.match(logs.join('\n'), /\[订单\] B店｜2｜/);
});

test('后台任务进度在同一业务页重绘并把记录写入独立日志', () => {
  const { 创建任务进度展示 } = require('../src/cli/startCli');
  const output = [];
  const logs = [];
  const pages = [];
  const 显示进度 = 创建任务进度展示({
    页面标题: '批量识别',
    输出: (text) => output.push(String(text)),
    记录运行日志: (text) => logs.push(String(text)),
    终端: { 显示页面: (title) => pages.push(title) },
  });

  显示进度({ message: '正在读取第 2/5 页' });

  assert.deepEqual(pages, ['京东发票回传 · 批量识别']);
  assert.match(output.join('\n'), /^\[进度\] 正在读取第 2\/5 页/);
  assert.match(output.join('\n'), /详细过程将直接显示在页面/);
  assert.match(logs.join('\n'), /正在读取第 2\/5 页/);
});

test('磁盘运行日志使用独立分页视图而不是铺进业务页', async () => {
  const { 查看运行日志 } = require('../src/cli/startCli');
  const output = [];
  const pages = [];
  const result = await 查看运行日志({
    输出: (text) => output.push(String(text)),
    终端: {
      主题: { 弱化: (text) => text },
      显示页面: (title) => pages.push(title),
    },
    提问器: { 询问: async () => '0' },
    读取日志: () => Array.from({ length: 15 }, (_, index) => `日志${index + 1}`),
  });

  assert.deepEqual(pages, ['京东发票回传 · 历史文件 · 运行日志']);
  assert.equal(output.some((text) => text === '日志1'), false);
  assert.equal(output.some((text) => text === '日志15'), true);
  assert.equal(result.跳过自动暂停, true);
});
