const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { 总入口版本 } = require('./共享CLI/应用元信息');
const { 构建默认店铺配置 } = require('./1.京东开票巡检/src/store/storeConfigService');

const 项目根目录 = __dirname;
const 客服包版本 = 总入口版本;
const 分发目录名称 = `发票自动化客服版-v${客服包版本}`;
const 子项目定义列表 = [
  {
    目录名称: '1.京东开票巡检',
    启动文件列表: ['启动巡检.bat'],
    数据文件列表: [
      ['stores.json', {
        stores: [{
          ...构建默认店铺配置(),
          enabled: false,
          username: '',
          password: '',
        }],
      }],
      ['store-results.json', { stores: {} }],
      ['invoice-order-state.json', {
        version: 2,
        orders: {},
        archivedHandledOrders: {},
        handledArchiveIndexBuiltAt: '',
      }],
      ['latest-invoices.json', []],
    ],
    包配置: { displayVersion: 客服包版本 },
  },
  {
    目录名称: '2.京东发票回传',
    启动文件列表: ['启动催票后台.bat'],
    数据文件列表: [
      ['stores.json', { stores: [], customerServiceNames: [] }],
      ['store-results.json', { stores: {} }],
      ['invoice-urge-orders.json', {
        version: 2,
        orders: {},
        archivedHandledOrders: {},
        handledArchiveIndexBuiltAt: '',
      }],
    ],
    包配置: { displayVersion: 客服包版本 },
  },
  {
    目录名称: '3.通用发票下载中心',
    启动文件列表: ['启动下载中心.bat'],
    数据文件列表: [
      ['invoice-system-config.json', {
        provider: 'nuonuo',
        targetUrl: 'https://work.nuonuo.com/index',
        username: '',
        password: '',
        invoiceSearchRangeDays: 30,
        searchAllInvoiceSubjects: true,
      }],
      ['invoice-system-auth-state.json', {}],
      ['invoice-file-index.json', { invoices: {} }],
    ],
  },
  {
    目录名称: '4.天猫发票回传',
    启动文件列表: ['启动天猫登录.bat'],
    数据文件列表: [
      ['stores.json', { stores: [] }],
      ['invoice-order-records.json', { version: 2, orders: {}, archivedHandledOrders: {}, handledArchiveIndexBuiltAt: '' }],
    ],
  },
  {
    目录名称: '5.拼多多发票回传',
    启动文件列表: ['启动拼多多后台.bat'],
    数据文件列表: [
      ['stores.json', { stores: [] }],
      ['invoice-order-records.json', { version: 2, orders: {}, archivedHandledOrders: {}, handledArchiveIndexBuiltAt: '' }],
    ],
  },
  {
    目录名称: '6.抖音发票回传',
    启动文件列表: ['启动抖音后台.bat'],
    数据文件列表: [
      ['stores.json', { stores: [] }],
      ['invoice-order-records.json', { version: 2, orders: {}, archivedHandledOrders: {}, handledArchiveIndexBuiltAt: '' }],
    ],
  },
];

function 格式化构建时间(时间 = new Date()) {
  const 年 = 时间.getFullYear();
  const 月 = String(时间.getMonth() + 1).padStart(2, '0');
  const 日 = String(时间.getDate()).padStart(2, '0');
  const 时 = String(时间.getHours()).padStart(2, '0');
  const 分 = String(时间.getMinutes()).padStart(2, '0');
  const 秒 = String(时间.getSeconds()).padStart(2, '0');
  return `${年}${月}${日}-${时}${分}${秒}`;
}

function 确保目录(目录路径) {
  fs.mkdirSync(目录路径, { recursive: true });
}

function 复制文件(源文件路径, 目标文件路径) {
  确保目录(path.dirname(目标文件路径));
  fs.copyFileSync(源文件路径, 目标文件路径);
}

function 复制目录(源目录路径, 目标目录路径) {
  确保目录(目标目录路径);
  const 复制结果 = spawnSync('robocopy', [
    源目录路径,
    目标目录路径,
    '/E',
    '/R:2',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NC',
    '/NS',
  ], {
    cwd: 项目根目录,
    stdio: 'inherit',
  });
  const 退出码 = 复制结果.status ?? 16;
  if (退出码 >= 8) {
    throw new Error(`复制目录失败：${源目录路径} -> ${目标目录路径}，robocopy 退出码=${退出码}。`);
  }
}

function 写入JSON文件(文件路径, 数据) {
  确保目录(path.dirname(文件路径));
  fs.writeFileSync(文件路径, `${JSON.stringify(数据, null, 2)}\r\n`, 'utf8');
}

function 写入文本文件(文件路径, 文本) {
  确保目录(path.dirname(文件路径));
  fs.writeFileSync(文件路径, 文本, 'utf8');
}

function 移动已有产物到备份(产物路径, 构建时间) {
  if (!fs.existsSync(产物路径)) return '';
  const 磁盘根目录 = path.parse(项目根目录).root;
  const 备份目录 = path.join(磁盘根目录, '备份文件夹', '2.发票自动化', '客服分发包', 构建时间);
  const 备份路径 = path.join(备份目录, path.basename(产物路径));
  确保目录(备份目录);
  fs.renameSync(产物路径, 备份路径);
  console.log(`[备份] 已移动旧产物：${备份路径}`);
  return 备份路径;
}

function 创建空运行目录(分发项目目录) {
  const 运行目录 = path.join(分发项目目录, 'runtime');
  [
    'node',
    'downloads',
    'screenshots',
    'store-profiles',
    'edge-profile',
  ].forEach((相对目录) => 确保目录(path.join(运行目录, 相对目录)));
  复制文件(process.execPath, path.join(运行目录, 'node', 'node.exe'));
}

function 创建根运行时(分发根目录) {
  复制文件(process.execPath, path.join(分发根目录, 'runtime', 'node', 'node.exe'));
}

function 创建空数据目录(分发项目目录, 子项目定义) {
  const 数据目录 = path.join(分发项目目录, 'data');
  确保目录(path.join(数据目录, 'reports'));
  确保目录(path.join(数据目录, 'store-snapshots'));
  子项目定义.数据文件列表.forEach(([相对路径, 数据]) => {
    写入JSON文件(path.join(数据目录, 相对路径), 数据);
  });

  const 源示例配置路径 = path.join(项目根目录, 子项目定义.目录名称, 'data', 'stores.example.json');
  if (fs.existsSync(源示例配置路径)) {
    复制文件(源示例配置路径, path.join(数据目录, 'stores.example.json'));
  }
}

function 复制子项目(分发根目录, 子项目定义) {
  const 源项目目录 = path.join(项目根目录, 子项目定义.目录名称);
  const 目标项目目录 = path.join(分发根目录, 子项目定义.目录名称);
  确保目录(目标项目目录);

  ['package.json', 'package-lock.json', 'README.md'].forEach((文件名) => {
    复制文件(path.join(源项目目录, 文件名), path.join(目标项目目录, 文件名));
  });
  子项目定义.启动文件列表.forEach((文件名) => {
    复制文件(path.join(源项目目录, 文件名), path.join(目标项目目录, 文件名));
  });
  ['src', 'scripts', 'node_modules'].forEach((目录名) => {
    const 源目录 = path.join(源项目目录, 目录名);
    if (fs.existsSync(源目录)) 复制目录(源目录, path.join(目标项目目录, 目录名));
  });

  创建空运行目录(目标项目目录);
  创建空数据目录(目标项目目录, 子项目定义);
  if (子项目定义.包配置) 写入JSON文件(path.join(目标项目目录, '打包配置.json'), 子项目定义.包配置);
}

function 生成客服说明(分发根目录) {
  const 说明内容 = [
    `发票自动化客服分发包 v${客服包版本}`,
    '',
    '使用方法：',
    '1. 解压整个文件夹，不要直接在压缩包内运行。',
    '2. 双击“启动发票自动化.bat”。',
    '3. 按需选择一个子项目；每个子项目均使用 CLI 菜单。',
    '4. 首次使用先在对应 CLI 中配置店铺，再执行登录；验证码等环节会打开真实业务网页人工完成。',
    '',
    '说明：',
    '1. 本包已内置 Node.js，不要求客服另行安装 Node.js 或 npm。',
    '2. 本包不包含原电脑的账号、密码、登录态、订单、发票和下载文件。',
    '3. 真实登录页面、验证码和业务操作仍会按需打开浏览器，这是业务自动化所必需的。',
  ].join('\r\n');
  写入文本文件(path.join(分发根目录, '客服使用说明.txt'), 说明内容);
}

function 生成根目录说明(分发根目录) {
  const 说明内容 = [
    `# 发票自动化客服分发包 v${客服包版本}`,
    '',
    '入口：双击“启动发票自动化.bat”。',
    '',
    '本包包含六个按需启动的 CLI 子项目，首次使用请先配置店铺并登录。',
  ].join('\r\n');
  写入文本文件(path.join(分发根目录, 'README.md'), 说明内容);
  写入JSON文件(path.join(分发根目录, '版本信息.json'), {
    displayVersion: 客服包版本,
    packageName: '发票自动化客服分发包',
    builtAt: new Date().toISOString(),
  });
}

function 压缩分发包(分发目录, 压缩包路径) {
  const 压缩命令 = `Compress-Archive -Path '${分发目录}\\*' -DestinationPath '${压缩包路径}' -Force`;
  const 压缩结果 = spawnSync('powershell.exe', ['-NoProfile', '-Command', 压缩命令], {
    cwd: 项目根目录,
    stdio: 'inherit',
  });
  if (压缩结果.status !== 0) {
    throw new Error(`压缩分发包失败，PowerShell 退出码=${压缩结果.status ?? 'null'}。`);
  }
}

function 主流程() {
  const 构建时间 = 格式化构建时间();
  const 分发根目录路径 = path.join(项目根目录, 'dist');
  const 正式分发目录 = path.join(分发根目录路径, 分发目录名称);
  const 临时分发目录 = path.join(分发根目录路径, `${分发目录名称}-build-${构建时间}`);
  const 压缩包路径 = path.join(分发根目录路径, `${分发目录名称}.zip`);

  移动已有产物到备份(正式分发目录, 构建时间);
  移动已有产物到备份(压缩包路径, 构建时间);
  确保目录(临时分发目录);

  复制文件(path.join(项目根目录, '启动发票自动化.bat'), path.join(临时分发目录, '启动发票自动化.bat'));
  复制文件(path.join(项目根目录, '总入口.js'), path.join(临时分发目录, '总入口.js'));
  复制目录(path.join(项目根目录, '共享CLI'), path.join(临时分发目录, '共享CLI'));
  复制目录(path.join(项目根目录, '共享订单状态'), path.join(临时分发目录, '共享订单状态'));
  复制目录(path.join(项目根目录, '共享发票回传'), path.join(临时分发目录, '共享发票回传'));
  创建根运行时(临时分发目录);
  生成客服说明(临时分发目录);
  生成根目录说明(临时分发目录);
  子项目定义列表.forEach((子项目定义) => 复制子项目(临时分发目录, 子项目定义));

  压缩分发包(临时分发目录, 压缩包路径);
  fs.renameSync(临时分发目录, 正式分发目录);
  console.log(`[完成] 客服目录：${正式分发目录}`);
  console.log(`[完成] 客服压缩包：${压缩包路径}`);
  console.log(`[完成] 版本：${客服包版本}`);
}

if (require.main === module) {
  try {
    主流程();
  } catch (错误) {
    console.error(`[失败] 客服分发包生成失败：${错误.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  客服包版本,
  子项目定义列表,
  格式化构建时间,
  主流程,
};
