const test = require('node:test');
const assert = require('node:assert/strict');
const {
  创建命令行终端,
  创建运行日志缓冲区,
  等待任务完成,
  启动命令行菜单,
  输出主菜单,
} = require('./命令行核心');

test('CLI首页统一输出作者、微信、官网和版本', () => {
  const 输出记录 = [];
  const 终端 = {
    清屏: () => {},
    输出标题: (标题, 副标题) => 输出记录.push(`${标题}\n${副标题}`),
    主题: {
      弱化: (文本) => String(文本),
      强调: (文本) => String(文本),
      正文: (文本) => String(文本),
    },
    分隔线: '---',
  };

  输出主菜单({
    标题: '测试项目',
    副标题: '测试首页',
    菜单分组: [],
    输出: (文本) => 输出记录.push(String(文本)),
    终端,
    应用展示信息: {
      appName: '测试项目',
      version: '1.2.3',
      authorName: '黎路遥',
      authorWechat: 'luyao2089',
      officialWebsite: 'luyao2089.cc',
      officialWebsiteUrl: 'https://luyao2089.cc',
    },
  });

  assert.match(输出记录.join('\n'), /作者：黎路遥｜微信：luyao2089｜官网：luyao2089\.cc｜版本：v1\.2\.3/);
  assert.doesNotMatch(输出记录.join('\n'), /\[L\]/);
});

test('运行日志缓冲只保留限定数量的最新记录', () => {
  const 日志 = 创建运行日志缓冲区(2);
  日志.记录('第一行');
  日志.记录('第二行\n第三行');

  assert.deepEqual(日志.读取(), ['第二行', '第三行']);
  assert.equal(日志.读取数量(), 2);
});

test('业务页面直接显示 console 诊断日志，不再使用独立日志页', async () => {
  const 输出记录 = [];
  const 页面记录 = [];
  const 控制台记录 = [];
  const 原始控制台日志 = console.log;
  console.log = (...messages) => 控制台记录.push(...messages.map(String));
  const answers = ['1', '', '0'];
  const 提问器 = {
    询问: async () => answers.shift() ?? '0',
    关闭: () => {},
  };
  const 终端 = 创建命令行终端({
    outputStream: { isTTY: false, write: () => {} },
    output: (文本) => 输出记录.push(String(文本)),
    clearScreen: () => 页面记录.push('clear'),
  });
  const 原始显示页面 = 终端.显示页面;
  终端.显示页面 = (标题, 副标题) => {
    页面记录.push(标题);
    原始显示页面(标题, 副标题);
  };

  try {
    await 启动命令行菜单({
      标题: '测试 CLI',
      菜单分组: [{ 项目: [{ 编号: '1', 名称: '执行任务' }] }],
      页面标题: { '1': '任务页面' },
      菜单动作: {
        '1': ({ 输出 }) => {
          输出('业务结果');
          console.log('内部诊断日志');
        },
      },
      提问器,
      终端,
      输出: (文本) => 输出记录.push(String(文本)),
    });
  } finally {
    console.log = 原始控制台日志;
  }

  const 业务页面位置 = 输出记录.indexOf('业务结果');
  assert.ok(业务页面位置 >= 0);
  assert.equal(控制台记录.filter((文本) => 文本 === '内部诊断日志').length, 1);
  assert.ok(!页面记录.some((标题) => 标题.includes('运行日志')));
  assert.ok(页面记录.includes('测试 CLI · 任务页面'));
});

test('未注入输出函数时仍通过专用输出流显示并正常退出', async () => {
  const writes = [];
  const outputStream = {
    isTTY: false,
    write: (text) => writes.push(String(text)),
  };
  await 启动命令行菜单({
    标题: '默认输出测试',
    菜单分组: [],
    菜单动作: {},
    输出流: outputStream,
    提问器: {
      询问: async () => '0',
      关闭: () => {},
    },
  });

  assert.match(writes.join(''), /默认输出测试 · CLI/);
  assert.match(writes.join(''), /默认输出测试 已退出/);
});

test('等待后台任务时可把状态交给固定进度页且不强制滚动输出', async () => {
  const 状态记录 = [];
  const 输出记录 = [];
  const 任务状态 = { status: 'idle', label: '已完成', message: '识别完成' };

  const result = await 等待任务完成(
    { running: false, state: { currentTask: 任务状态 } },
    (text) => 输出记录.push(text),
    (state) => 状态记录.push(state),
  );

  assert.strictEqual(result, 任务状态);
  assert.deepEqual(状态记录, [任务状态]);
  assert.deepEqual(输出记录, ['[结果] 识别完成']);
});
