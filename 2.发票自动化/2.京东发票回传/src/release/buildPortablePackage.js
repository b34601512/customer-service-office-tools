const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { 打印日志 } = require('../common/logger');
const { 项目根目录 } = require('../common/paths');
const { 解析发布信息, 读取打包配置, 读取发布信息 } = require('../common/releaseInfo');
const { 构建默认店铺配置 } = require('../store/storeConfigService');
const {
  创建自动递增发布计划,
  写入项目打包配置,
} = require('./packageVersionService');
const { 校验客服分发包不含敏感数据 } = require('./packageSafetyGuard');

function 格式化备份时间(时间 = new Date()) {
  // 解决：统一生成稳定备份目录名，避免反复打包时旧产物互相覆盖。
  const 年 = 时间.getFullYear();
  const 月 = String(时间.getMonth() + 1).padStart(2, '0');
  const 日 = String(时间.getDate()).padStart(2, '0');
  const 时 = String(时间.getHours()).padStart(2, '0');
  const 分 = String(时间.getMinutes()).padStart(2, '0');
  const 秒 = String(时间.getSeconds()).padStart(2, '0');
  return `${年}${月}${日}-${时}${分}${秒}`;
}

function 获取打包备份目录(projectRoot = 项目根目录, 时间文本 = 格式化备份时间()) {
  // 解决：把旧分发产物统一移到当前硬盘根目录的备份文件夹，满足项目不硬删除的约束。
  const 项目目录名 = path.basename(projectRoot);
  const 磁盘根目录 = path.parse(projectRoot).root;
  return path.join(磁盘根目录, '备份文件夹', 项目目录名, '打包产物备份', 时间文本);
}

function 备份已有产物(产物路径, options = {}) {
  // 解决：重打包前先移动旧产物到备份目录，避免直接硬删除历史包。
  const { projectRoot = 项目根目录, 时间文本 = 格式化备份时间() } = options;
  if (!fs.existsSync(产物路径)) {
    return '';
  }

  const 备份目录 = 获取打包备份目录(projectRoot, 时间文本);
  fs.mkdirSync(备份目录, { recursive: true });
  const 备份路径 = path.join(备份目录, path.basename(产物路径));
  fs.renameSync(产物路径, 备份路径);
  打印日志('分发打包', '客服分发包', `旧产物已移入备份：${备份路径}`);
  return 备份路径;
}

function 准备输出目录(目录路径, options = {}) {
  // 解决：每次导出前先备份旧目录，再创建干净输出目录，避免旧文件混进新分发包。
  const { projectRoot = 项目根目录, 时间文本 = 格式化备份时间() } = options;
  备份已有产物(目录路径, {
    projectRoot,
    时间文本,
  });
  fs.mkdirSync(目录路径, { recursive: true });
}

function 复制文件(源路径, 目标路径) {
  // 解决：复制单文件前统一创建父目录，避免路径不存在时报错。
  fs.mkdirSync(path.dirname(目标路径), { recursive: true });
  fs.copyFileSync(源路径, 目标路径);
}

function 复制目录(源目录, 目标目录) {
  // 解决：Windows 下复制大目录时改用 robocopy，避免 fs.cpSync 在当前环境直接异常退出。
  fs.mkdirSync(目标目录, { recursive: true });
  const 复制结果 = spawnSync('robocopy', [
    源目录,
    目标目录,
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
    throw new Error(`目录复制失败：${源目录} -> ${目标目录}，robocopy 退出码=${退出码}。`);
  }
}

function 写入JSON文件(文件路径, 数据) {
  // 解决：导出包里的初始数据文件统一保持 UTF-8 JSON，避免客服机首次启动解析失败。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, JSON.stringify(数据, null, 2), 'utf8');
}

function 写入文本文件(文件路径, 文本) {
  // 解决：导出包里的说明文档统一使用 UTF-8，避免中文乱码。
  fs.mkdirSync(path.dirname(文件路径), { recursive: true });
  fs.writeFileSync(文件路径, 文本, 'utf8');
}

function 获取分发目录名(显示版本) {
  // 解决：分发产物目录名统一使用 ASCII，避免部分 Windows/Node 环境在中文打包路径下异常退出。
  return `jd-invoice-urge-watch-cs-v${显示版本}`;
}

function 获取临时构建目录(正式构建目录, 时间文本 = 格式化备份时间()) {
  // 解决：每次打包都先写入独立临时目录，避免旧分发目录被占用时整次打包失败。
  return `${正式构建目录}-build-${时间文本}`;
}

function 构建分发初始店铺配置() {
  // 解决：分发包只带空白模板店铺，既能正常打开后台，也不会泄露当前电脑上的真实店铺信息。
  return {
    stores: [
      {
        ...构建默认店铺配置(),
        enabled: false,
        username: '',
        password: '',
      },
    ],
  };
}

function 构建干净数据目录(分发目录) {
  // 解决：分发包的数据目录只保留空白模板，不把本机真实店铺信息、历史结果和旧快照带出去。
  const 数据目录 = path.join(分发目录, 'data');
  const 分发店铺配置路径 = path.join(数据目录, 'stores.json');

  fs.mkdirSync(path.join(数据目录, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(数据目录, 'store-snapshots'), { recursive: true });
  写入JSON文件(分发店铺配置路径, 构建分发初始店铺配置());

  写入JSON文件(path.join(数据目录, 'store-results.json'), {
    version: 2,
    stores: {},
    lastBatchSummary: null,
    lastSingleSummary: null,
  });
  写入JSON文件(path.join(数据目录, 'latest-invoices.json'), []);
  写入JSON文件(path.join(数据目录, 'invoice-urge-orders.json'), {
    version: 2,
    orders: {},
    archivedHandledOrders: {},
    handledArchiveIndexBuiltAt: '',
  });
}

function 构建干净运行目录(分发目录) {
  // 解决：分发包自带 node.exe，但不携带当前电脑的浏览器登录档案和窗口缓存。
  const 运行目录 = path.join(分发目录, 'runtime');
  const 便携Node目录 = path.join(运行目录, 'node');
  const 当前Node路径 = process.execPath;

  fs.mkdirSync(path.join(运行目录, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(运行目录, 'store-profiles'), { recursive: true });
  fs.mkdirSync(path.join(运行目录, 'edge-profile'), { recursive: true });
  fs.mkdirSync(便携Node目录, { recursive: true });

  复制文件(当前Node路径, path.join(便携Node目录, 'node.exe'));
}

function 写入客服说明(分发目录, 发布信息) {
  // 解决：让客服拿到包后只看一页说明就知道怎么启动和首次登录，不需要再问开发。
  const 说明内容 = [
    `京东催促开票记录 客服版 ${发布信息.显示版本}`,
    '',
    '使用步骤：',
    '1. 解压整个压缩包，不要直接在压缩包里双击运行。',
    '2. 双击“启动催票后台.bat”。',
    '3. 首次使用时，在 CLI 菜单中按店铺逐个登录一次；后续会复用本机登录态。',
    '4. 遇到滑块或短信验证时，系统会停住等待人工处理，不会再自动乱点。',
    '',
    '注意事项：',
    '1. 分发包已经自带 Node 运行时，不需要额外安装 Node 或 npm。',
    '2. 分发包不会携带导出电脑上的登录痕迹，你需要在当前电脑重新登录。',
    '3. 分发包默认不带当前电脑里的店铺名称、账号和密码，你需要在目标电脑重新配置。',
  ].join('\r\n');

  写入文本文件(path.join(分发目录, '客服使用说明.txt'), 说明内容);
}

function 获取分发根文件列表() {
  // 解决：把分发根目录需要带出的文件集中收口，避免版本配置这类关键文件漏拷贝。
  return ['启动催票后台.bat', 'package.json', 'package-lock.json', 'README.md', '打包配置.json'];
}

function 复制项目主体(分发目录, options = {}) {
  // 解决：把运行所需代码和依赖完整复制出去，确保客服机离线也能直接启动。
  const { 打包配置覆盖值 = null } = options;
  const 文件列表 = 获取分发根文件列表();
  文件列表.forEach((文件名) => {
    复制文件(path.join(项目根目录, 文件名), path.join(分发目录, 文件名));
  });

  if (打包配置覆盖值) {
    写入JSON文件(path.join(分发目录, '打包配置.json'), 打包配置覆盖值);
  }

  复制目录(path.join(项目根目录, 'src'), path.join(分发目录, 'src'));
  复制目录(path.join(项目根目录, '..', '共享CLI'), path.join(分发目录, '共享CLI'));
  复制目录(path.join(项目根目录, '..', '共享订单状态'), path.join(分发目录, '共享订单状态'));
  复制目录(path.join(项目根目录, '..', '共享发票回传'), path.join(分发目录, '共享发票回传'));
  复制目录(path.join(项目根目录, 'node_modules'), path.join(分发目录, 'node_modules'));
}

function 压缩分发包(分发目录, 压缩包路径, options = {}) {
  // 解决：导出结束后直接生成 zip，方便你发给客服，不需要手工再压缩一次。
  const { projectRoot = 项目根目录, 时间文本 = 格式化备份时间() } = options;
  备份已有产物(压缩包路径, {
    projectRoot,
    时间文本,
  });
  const PowerShell命令 = `Compress-Archive -Path '${分发目录}\\*' -DestinationPath '${压缩包路径}' -Force`;
  const 压缩结果 = spawnSync('powershell.exe', ['-NoProfile', '-Command', PowerShell命令], {
    cwd: 项目根目录,
    stdio: 'inherit',
  });

  if (压缩结果.status !== 0) {
    throw new Error(`分发包压缩失败，PowerShell 退出码=${压缩结果.status ?? 'null'}。`);
  }
}

function 落位分发目录(临时构建目录, 正式构建目录, options = {}) {
  // 解决：优先把临时构建目录切到正式目录；若旧目录被占用，则保留临时目录并继续交付 zip。
  const { projectRoot = 项目根目录, 时间文本 = 格式化备份时间() } = options;

  try {
    备份已有产物(正式构建目录, {
      projectRoot,
      时间文本,
    });
    fs.renameSync(临时构建目录, 正式构建目录);
    return 正式构建目录;
  } catch (错误) {
    if (错误 && (错误.code === 'EBUSY' || 错误.code === 'EPERM' || 错误.code === 'EACCES')) {
      打印日志('分发打包', '客服分发包', `正式目录被占用，新的构建目录已保留在：${临时构建目录}`);
      return 临时构建目录;
    }
    throw 错误;
  }
}

function main() {
  // 解决：一键导出客服分发包，统一完成清目录、复制主体、注入便携 Node 和压缩归档。
  const 发布计划 = 创建自动递增发布计划(项目根目录);
  const 发布信息 = 发布计划.新发布信息;
  打印日志('分发打包', '版本管理', `当前版本=${发布计划.当前发布信息.显示版本}`);
  打印日志('分发打包', '版本管理', `本次默认自动版本号+1，新版本=${发布信息.显示版本}`);

  const 备份时间文本 = 格式化备份时间();
  const 目录名 = 获取分发目录名(发布信息.显示版本);
  const 正式构建目录 = path.join(项目根目录, 'dist', 目录名);
  const 临时构建目录 = 获取临时构建目录(正式构建目录, 备份时间文本);
  const 压缩包路径 = path.join(项目根目录, 'dist', `${目录名}.zip`);

  打印日志('分发打包', '客服分发包', `开始导出：${目录名}`);
  准备输出目录(临时构建目录, {
    projectRoot: 项目根目录,
    时间文本: 备份时间文本,
  });
  复制项目主体(临时构建目录, {
    打包配置覆盖值: 发布计划.新打包配置,
  });
  构建干净数据目录(临时构建目录);
  构建干净运行目录(临时构建目录);
  写入客服说明(临时构建目录, 发布信息);
  const 安全校验结果 = 校验客服分发包不含敏感数据(临时构建目录);
  打印日志('分发打包', '安全校验', `已确认分发包无账号密码和登录态，店铺模板数量=${安全校验结果.店铺数量}`);
  压缩分发包(临时构建目录, 压缩包路径, {
    projectRoot: 项目根目录,
    时间文本: 备份时间文本,
  });
  const 实际构建目录 = 落位分发目录(临时构建目录, 正式构建目录, {
    projectRoot: 项目根目录,
    时间文本: 备份时间文本,
  });
  const 打包配置路径 = 写入项目打包配置(发布计划.新打包配置, 项目根目录);
  打印日志('分发打包', '版本管理', `打包成功，打包配置已更新：${打包配置路径}`);
  打印日志('分发打包', '客服分发包', `导出完成：${实际构建目录}`);
  打印日志('分发打包', '客服分发包', `压缩包已生成：${压缩包路径}`);
  打印日志('分发打包', '客服分发包', `内部版本=${发布信息.内部版本}，对外显示版本=${发布信息.显示版本}`);
}

if (require.main === module) {
  try {
    main();
  } catch (错误) {
    打印日志('分发打包', '客服分发包', `导出失败：${错误.message}`);
    process.exit(1);
  }
}

module.exports = {
  main,
  解析发布信息,
  读取打包配置,
  读取发布信息,
  获取分发根文件列表,
  构建分发初始店铺配置,
  校验客服分发包不含敏感数据,
};
