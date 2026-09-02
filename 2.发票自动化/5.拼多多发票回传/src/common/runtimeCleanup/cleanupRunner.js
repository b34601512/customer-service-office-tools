const fs = require('fs');
const { 项目根目录 } = require('../paths');
const { 打印日志 } = require('../logger');
const { 计算路径大小字节 } = require('./pathSize');
const { 迁移到备份目录 } = require('./pathMigration');
const { 格式化体积 } = require('./formatSize');

function 构建清理结果(目标路径, 路径大小, 备份路径) {
  // 解决：把一次路径迁移收敛成日志和测试共用的结果结构。
  return {
    原路径: 目标路径,
    备份路径,
    字节数: 路径大小,
  };
}

function 迁移存在的运行垃圾路径列表(路径列表, 选项 = {}) {
  // 解决：运行垃圾只要存在就迁移，不等它膨胀到阈值后才清理。
  const {
    now = new Date(),
    projectRoot = 项目根目录,
    备份根目录,
  } = 选项;
  const 清理结果 = [];
  for (const 目标路径 of 路径列表) {
    if (!fs.existsSync(目标路径)) {
      continue;
    }
    const 路径大小 = 计算路径大小字节(目标路径);
    const 备份路径 = 迁移到备份目录(目标路径, { now, projectRoot, 备份根目录 });
    清理结果.push(构建清理结果(目标路径, 路径大小, 备份路径));
  }
  return 清理结果;
}

function 打印清理日志(日志模块名, 清理结果) {
  // 解决：只在确实迁移了运行垃圾时打印一行高信号日志。
  if (清理结果.length === 0) {
    return;
  }
  const 总字节数 = 清理结果.reduce((sum, item) => sum + item.字节数, 0);
  打印日志('启动自动清理', 日志模块名, `已迁移 ${清理结果.length} 项，约 ${格式化体积(总字节数)}`);
}

function 清理运行垃圾路径列表({ 路径列表, 日志模块名, now = new Date(), projectRoot = 项目根目录, 备份根目录 }) {
  // 解决：统一编排运行垃圾迁移和日志输出，避免各模块自己移动文件。
  const 清理结果 = 迁移存在的运行垃圾路径列表(路径列表, {
    now,
    projectRoot,
    备份根目录,
  });
  打印清理日志(日志模块名, 清理结果);
  return 清理结果;
}

module.exports = {
  构建清理结果,
  迁移存在的运行垃圾路径列表,
  打印清理日志,
  清理运行垃圾路径列表,
};
