const path = require('path');
const {
  项目根目录,
  截图目录,
  拼多多导出目录,
  全流程临时目录,
} = require('../paths');
const { 清理运行垃圾路径列表 } = require('./cleanupRunner');

function 构建启动清理路径列表(projectRoot = 项目根目录) {
  // 解决：启动清理只覆盖不需要继承的运行产物，绝不清理店铺登录资料目录。
  if (path.resolve(projectRoot) === path.resolve(项目根目录)) {
    return [
      截图目录,
      拼多多导出目录,
      全流程临时目录,
    ];
  }

  return [
    path.join(projectRoot, 'runtime', 'screenshots'),
    path.join(projectRoot, 'runtime', 'pdd-exports'),
    path.join(projectRoot, 'runtime', 'full-flow'),
  ];
}

async function 执行启动自动清理(选项 = {}) {
  // 解决：后台启动时先迁移临时产物，保持项目运行目录长期干净。
  const {
    projectRoot = 项目根目录,
    now = new Date(),
    备份根目录,
    路径列表 = 构建启动清理路径列表(projectRoot),
  } = 选项;
  return 清理运行垃圾路径列表({
    路径列表,
    now,
    projectRoot,
    备份根目录,
    日志模块名: '运行临时产物',
  });
}

module.exports = {
  构建启动清理路径列表,
  执行启动自动清理,
};
