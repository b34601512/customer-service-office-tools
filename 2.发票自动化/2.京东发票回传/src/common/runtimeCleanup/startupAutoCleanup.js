const fs = require('fs');
const path = require('path');
const { 打印日志 } = require('../logger');
const {
  项目根目录,
  催票订单记录文件路径,
  店铺浏览器目录,
  获取店铺浏览器目录,
  获取店铺登录态文件路径,
} = require('../paths');
const { 记录自动清理结果 } = require('../performanceCleanupState');
const { 计算路径大小字节 } = require('./pathSize');
const { 迁移到备份目录 } = require('./pathMigration');
const { 归档清理已处理订单 } = require('../../order/jdOrderRecordStore');
const { 读取店铺配置 } = require('../../store/storeConfigService');
const { 迁移旧浏览器档案登录态 } = require('../../browser/storeBrowser/legacyProfileMigration');

function 读取启动清理店铺列表(选项 = {}) {
  // 解决：启动清理只读取一次店铺配置，避免后续步骤反复理解配置文件。
  if (Array.isArray(选项.店铺列表)) {
    return 选项.店铺列表;
  }
  return 读取店铺配置().stores;
}

function 生成项目内店铺浏览器目录(projectRoot, 店铺标识) {
  // 解决：测试目录和真实项目目录共用同一套旧 profile 路径规则。
  if (path.resolve(projectRoot) === path.resolve(项目根目录)) {
    return 获取店铺浏览器目录(店铺标识);
  }
  return path.join(projectRoot, 'runtime', 'store-profiles', 店铺标识);
}

function 生成项目内店铺登录态路径(projectRoot, 店铺标识) {
  // 解决：测试目录和真实项目目录共用同一套最小登录态路径规则。
  if (path.resolve(projectRoot) === path.resolve(项目根目录)) {
    return 获取店铺登录态文件路径(店铺标识);
  }
  return path.join(projectRoot, 'data', 'store-auth-states', `${店铺标识}.json`);
}

function 构建配置店铺标识集合(店铺列表) {
  // 解决：用物理目录名判断哪些旧 profile 仍属于当前配置里的店铺。
  return new Set((店铺列表 || [])
    .map((店铺) => String(店铺?.id || '').trim())
    .filter(Boolean));
}

function 读取旧店铺档案目录列表(店铺浏览器根目录路径 = 店铺浏览器目录) {
  // 解决：只迁移旧完整 profile 的一级店铺目录，不碰其它运行文件。
  if (!fs.existsSync(店铺浏览器根目录路径)) {
    return [];
  }
  return fs.readdirSync(店铺浏览器根目录路径, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(店铺浏览器根目录路径, entry.name));
}

function 构建迁移记录(原路径, 备份路径, 字节数) {
  // 解决：把旧档案迁移结果转成性能面板能展示的统一结构。
  if (!备份路径) {
    return null;
  }
  return {
    原路径,
    备份路径,
    字节数,
  };
}

function 记录自动清理运行(选项 = {}) {
  // 解决：每个自动动作都写入性能状态，用户打开性能弹窗能看到本次启动做过什么。
  return 记录自动清理结果(选项);
}

function 自动归档已处理历史记录(选项 = {}) {
  // 解决：启动时自动把已处理订单移到备份区，避免订单记录长期膨胀拖慢首页。
  const {
    orderRecordFilePath = 催票订单记录文件路径,
    projectRoot = 项目根目录,
    now = new Date(),
    备份根目录,
    归档函数 = 归档清理已处理订单,
    记录函数 = 记录自动清理运行,
  } = 选项;
  const result = 归档函数(orderRecordFilePath, { projectRoot, now, 备份根目录 });
  记录函数({
    projectRoot,
    now,
    cleanupType: 'handled-order-history',
    moduleName: '已处理历史记录',
    checkedPathCount: 1,
    removedOrderCount: result.removedCount,
    backupPath: result.backupPath,
  });
  if (result.removedCount > 0) {
    打印日志('启动自动清理', '已处理历史记录', `已归档 ${result.removedCount} 条：${result.backupPath}`);
  }
  return result;
}

async function 自动迁移配置店铺旧档案(选项 = {}) {
  // 解决：配置里的旧完整 profile 在启动时自动转成最小登录态并移出项目。
  const {
    店铺列表 = [],
    projectRoot = 项目根目录,
    now = new Date(),
    备份根目录,
    迁移函数 = 迁移旧浏览器档案登录态,
    记录函数 = 记录自动清理运行,
  } = 选项;
  const 迁移结果列表 = [];
  for (const 店铺 of 店铺列表) {
    const 店铺标识 = String(店铺?.id || '').trim();
    if (!店铺标识) {
      continue;
    }
    const 旧浏览器目录 = 生成项目内店铺浏览器目录(projectRoot, 店铺标识);
    const 迁移前字节数 = fs.existsSync(旧浏览器目录) ? 计算路径大小字节(旧浏览器目录) : 0;
    const result = await 迁移函数({
      店铺标识,
      旧浏览器目录,
      登录态文件路径: 生成项目内店铺登录态路径(projectRoot, 店铺标识),
      启动地址: 店铺.targetUrl || '',
      now,
      projectRoot,
      备份根目录,
    });
    const 迁移记录 = 构建迁移记录(旧浏览器目录, result?.backupPath || '', 迁移前字节数);
    if (迁移记录) {
      迁移结果列表.push(迁移记录);
    }
  }
  记录函数({
    projectRoot,
    now,
    cleanupType: 'legacy-store-profile',
    moduleName: '配置店铺旧浏览器档案',
    checkedPathCount: 店铺列表.length,
    cleanupResults: 迁移结果列表,
  });
  return 迁移结果列表;
}

function 自动归档未配置旧店铺档案(选项 = {}) {
  // 解决：已经不在配置里的旧 profile 没有继续留在项目 runtime 的必要，启动时迁移到备份区。
  const {
    店铺列表 = [],
    projectRoot = 项目根目录,
    now = new Date(),
    备份根目录,
    店铺浏览器根目录路径 = path.join(projectRoot, 'runtime', 'store-profiles'),
    迁移函数 = 迁移到备份目录,
    记录函数 = 记录自动清理运行,
  } = 选项;
  const 配置店铺标识集合 = 构建配置店铺标识集合(店铺列表);
  const 旧档案目录列表 = 读取旧店铺档案目录列表(店铺浏览器根目录路径)
    .filter((目录路径) => !配置店铺标识集合.has(path.basename(目录路径)));
  const 迁移结果列表 = [];
  for (const 旧档案目录 of 旧档案目录列表) {
    const 迁移前字节数 = 计算路径大小字节(旧档案目录);
    const 备份路径 = 迁移函数(旧档案目录, { now, projectRoot, 备份根目录 });
    const 迁移记录 = 构建迁移记录(旧档案目录, 备份路径, 迁移前字节数);
    if (迁移记录) {
      迁移结果列表.push(迁移记录);
    }
  }
  记录函数({
    projectRoot,
    now,
    cleanupType: 'orphan-store-profile',
    moduleName: '未配置店铺旧浏览器档案',
    checkedPathCount: 旧档案目录列表.length,
    cleanupResults: 迁移结果列表,
  });
  return 迁移结果列表;
}

async function 执行启动自动清理(选项 = {}) {
  // 解决：后台启动时集中自动归档会膨胀的历史数据和旧浏览器档案。
  const {
    projectRoot = 项目根目录,
    now = new Date(),
  } = 选项;
  const 店铺列表 = 读取启动清理店铺列表(选项);
  const history = 自动归档已处理历史记录({ ...选项, projectRoot, now });
  const configuredStoreProfiles = await 自动迁移配置店铺旧档案({ ...选项, 店铺列表, projectRoot, now });
  const orphanStoreProfiles = 自动归档未配置旧店铺档案({ ...选项, 店铺列表, projectRoot, now });
  return {
    history,
    configuredStoreProfiles,
    orphanStoreProfiles,
  };
}

module.exports = {
  读取启动清理店铺列表,
  生成项目内店铺浏览器目录,
  生成项目内店铺登录态路径,
  构建配置店铺标识集合,
  读取旧店铺档案目录列表,
  自动归档已处理历史记录,
  自动迁移配置店铺旧档案,
  自动归档未配置旧店铺档案,
  执行启动自动清理,
};
