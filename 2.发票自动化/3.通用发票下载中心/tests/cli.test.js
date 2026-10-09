const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { 创建命令行操作, 解析订单号文本, 读取是否确认, 读取检索天数 } = require('../src/cli/commandLineOperations');
const { 启动命令行菜单 } = require('../src/cli/commandLineMenu');
const { 创建命令行提问器 } = require('../src/cli/commandLinePrompt');
const { 创建命令行主题, 创建命令行终端 } = require('../src/cli/commandLineTerminal');
const { 规范化发票系统配置, 构建安全发票系统配置视图 } = require('../src/config/invoiceSystemConfig');

function 创建假提问器(回答列表) {
  return {
    询问: async () => 回答列表.shift() ?? '',
    询问密码: async () => 回答列表.shift() ?? '',
    关闭: () => {},
  };
}

test('命令行终端在可见终端中使用清屏控制符', () => {
  const 写入记录 = [];
  const 终端 = 创建命令行终端({
    outputStream: { isTTY: true, write: (内容) => 写入记录.push(内容) },
    output: () => {},
  });

  终端.清屏();

  assert.equal(写入记录.join(''), '\u001b[2J\u001b[H');
});

test('命令行提问器可以连续消费已输入的多行内容', async () => {
  const 输入流 = new PassThrough();
  const 输出流 = { write: () => true };
  const 命令行提问器 = 创建命令行提问器({ input: 输入流, output: 输出流 });
  const 第一行回答 = 命令行提问器.询问('');
  const 第二行回答 = 命令行提问器.询问('');
  输入流.end('第一行\n第二行\n');

  assert.equal(await 第一行回答, '第一行');
  assert.equal(await 第二行回答, '第二行');
  命令行提问器.关闭();
});

test('订单号文本支持常见分隔符', () => {
  assert.deepEqual(解析订单号文本('1001, 1002；1001 1003'), ['1001', '1002', '1001', '1003']);
});

test('强制下载只接受明确确认', () => {
  assert.equal(读取是否确认('y'), true);
  assert.equal(读取是否确认('确认'), true);
  assert.equal(读取是否确认(''), false);
  assert.equal(读取是否确认('yes please'), false);
});

test('检索天数使用统一范围规则', () => {
  assert.equal(读取检索天数('', 30, (value) => Number(value)), 30);
  assert.throws(() => 读取检索天数('366', 30, (value) => {
    if (Number(value) > 365) throw new Error('超出范围');
    return Number(value);
  }), /超出范围/);
});

test('命令行菜单会把编号分发到对应操作并统一清理', async () => {
  const 调用记录 = [];
  const 操作 = {
    查看当前状态: () => 调用记录.push('status'),
    配置发票系统: () => 调用记录.push('config'),
    检查诺诺登录: () => 调用记录.push('login'),
    批量下载发票: () => 调用记录.push('download'),
    查看本地发票: () => 调用记录.push('local'),
    打开下载目录: () => 调用记录.push('folder'),
    导入旧京东配置: () => 调用记录.push('import'),
    关闭: () => 调用记录.push('close'),
  };
  const 命令行提问器 = 创建假提问器(['1', '', '2', '', '3', '', '4', '', '5', '', '6', '', '7', '', '0']);
  const 输出记录 = [];
  let 清屏次数 = 0;

  await 启动命令行菜单({
    prompt: 命令行提问器,
    operations: 操作,
    output: (message) => 输出记录.push(message),
    clearScreen: () => { 清屏次数 += 1; },
    cleanupResidualProcesses: () => ({ cleanedPids: [] }),
  });

  assert.deepEqual(调用记录, ['status', 'config', 'login', 'download', 'local', 'folder', 'import', 'close']);
  assert.equal(清屏次数, 16);
  assert.match(输出记录.join('\n'), /通用发票下载中心/);
  assert.match(输出记录.join('\n'), /作者：黎路遥｜微信：luyao2089｜官网：luyao2089\.cc｜版本：v0\.1\.0/);
  assert.match(输出记录.join('\n'), /账户与登录/);
  assert.match(输出记录.join('\n'), /发票处理/);
  assert.match(输出记录.join('\n'), /下载中心已退出/);
});

test('命令行配置会保存账号密码和检索范围', async () => {
  let 当前配置 = 规范化发票系统配置({ username: 'old-user', password: 'old-pass', invoiceSearchRangeDays: 30 });
  const 输出记录 = [];
  const 操作 = 创建命令行操作({
    readInvoiceSystemConfig: () => 当前配置,
    saveInvoiceSystemConfig: (config) => {
      当前配置 = 规范化发票系统配置(config);
      return 当前配置;
    },
    output: (message) => 输出记录.push(message),
  });

  await 操作.配置发票系统(创建假提问器(['new-user', 'new-pass', '45']));

  assert.equal(当前配置.username, 'new-user');
  assert.equal(当前配置.password, 'new-pass');
  assert.equal(当前配置.invoiceSearchRangeDays, 45);
  assert.equal(输出记录.join('\n').includes('new-pass'), false);
});

test('当前状态会实时显示诺诺登录结果并使用多种颜色', async () => {
  const 输出记录 = [];
  const 原无色环境变量 = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  const 主题 = 创建命令行主题({ isTTY: true });
  let 验证参数 = null;
  try {
    const 操作 = 创建命令行操作({
      readInvoiceSystemConfig: () => 规范化发票系统配置({ username: 'tester', password: 'secret' }),
      verifyNuonuoLogin: async (config, options) => {
        验证参数 = { config, options };
        return { ok: true, invoiceSubjectCount: 2 };
      },
      getDownloadsDirectory: () => 'D:\\invoices',
      output: (message) => 输出记录.push(message),
      theme: 主题,
    });

    await 操作.查看当前状态();

    const 全部输出 = 输出记录.join('\n');
    assert.equal(验证参数.options.headless, true);
    assert.equal(验证参数.options.keepBrowserOpenOnManualLogin, false);
    assert.match(全部输出, /登录状态/);
    assert.match(全部输出, /已登录/);
    assert.match(全部输出, /\u001b\[32m/);
    assert.match(全部输出, /\u001b\[34m/);
  } finally {
    if (原无色环境变量 === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = 原无色环境变量;
  }
});

test('命令行批量下载支持本地缓存参数和逐单结果', async () => {
  let 调用参数 = null;
  const 输出记录 = [];
  const 操作 = 创建命令行操作({
    readInvoiceSystemConfig: () => 规范化发票系统配置({ invoiceSearchRangeDays: 20 }),
    batchDownloadInvoices: async (input, options) => {
      调用参数 = { input, options };
      return [
        { orderNumber: '1001', invoiceFilePath: 'D:\\invoices\\1001.pdf' },
        { orderNumber: '1002', invoiceFilePath: 'D:\\invoices\\1002.pdf' },
      ];
    },
    output: (message) => 输出记录.push(message),
  });

  await 操作.批量下载发票(创建假提问器(['1001,1002', '1002', '', 'y']));

  assert.deepEqual(调用参数.input.orderNumbers, ['1001', '1002']);
  assert.equal(调用参数.input.force, true);
  assert.equal(调用参数.options.invoiceSearchRangeDays, 20);
  assert.match(输出记录.join('\n'), /1001/);
  assert.match(输出记录.join('\n'), /1002/);
});

test('命令行登录会等待人工完成后再次验证', async () => {
  const 验证次数 = [];
  let 清理次数 = 0;
  const 输出记录 = [];
  const 操作 = 创建命令行操作({
    readInvoiceSystemConfig: () => 规范化发票系统配置({ username: 'tester', password: 'secret' }),
    verifyNuonuoLogin: async () => {
      验证次数.push(true);
      return 验证次数.length === 1
        ? { ok: false, requiresManualLogin: true, message: '请人工登录。' }
        : { ok: true, invoiceSubjectCount: 1 };
    },
    closePendingLoginSession: async () => {
      清理次数 += 1;
    },
    output: (message) => 输出记录.push(message),
  });

  const 登录结果 = await 操作.检查诺诺登录(创建假提问器(['']));

  assert.equal(登录结果, true);
  assert.equal(验证次数.length, 2);
  assert.equal(清理次数, 0);
  assert.match(输出记录.join('\n'), /登录检查通过/);
});

test('安全配置摘要不包含完整密码', () => {
  const safeConfig = 构建安全发票系统配置视图({ username: 'tester', password: 'secret' });
  assert.equal(Object.hasOwn(safeConfig, 'password'), false);
  assert.equal(safeConfig.hasPassword, true);
});
