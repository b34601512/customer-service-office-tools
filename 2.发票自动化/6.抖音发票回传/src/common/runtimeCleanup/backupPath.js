const fs = require('fs');
const path = require('path');
const { 项目根目录, 获取当前硬盘备份目录 } = require('../paths');

const 运行缓存备份目录名 = '抖音发票回传-runtime缓存备份';

function 格式化备份批次时间(now = new Date()) {
  // 解决：用稳定时间批次区分每次自动清理，避免备份互相覆盖。
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function 生成不冲突路径(目标路径) {
  // 解决：同一秒重复迁移同一路径时自动追加编号。
  if (!fs.existsSync(目标路径)) {
    return 目标路径;
  }

  const 父目录 = path.dirname(目标路径);
  const 扩展名 = path.extname(目标路径);
  const 基础名 = path.basename(目标路径, 扩展名);
  for (let index = 1; index < 1000; index += 1) {
    const 候选路径 = path.join(父目录, `${基础名}-${index}${扩展名}`);
    if (!fs.existsSync(候选路径)) {
      return 候选路径;
    }
  }

  throw new Error(`生成备份路径失败：${目标路径}`);
}

function 构建备份目标路径(目标路径, 选项 = {}) {
  // 解决：保留原始相对路径，让后续需要对照时能看懂来源。
  const {
    projectRoot = 项目根目录,
    now = new Date(),
    备份根目录 = 获取当前硬盘备份目录(projectRoot),
  } = 选项;
  const 绝对目标路径 = path.resolve(目标路径);
  const 相对项目路径 = path.relative(path.resolve(projectRoot), 绝对目标路径);
  const 安全相对路径 = 相对项目路径 && !相对项目路径.startsWith('..')
    ? 相对项目路径
    : path.basename(绝对目标路径);
  return path.join(备份根目录, 运行缓存备份目录名, 格式化备份批次时间(now), 安全相对路径);
}

module.exports = {
  运行缓存备份目录名,
  格式化备份批次时间,
  生成不冲突路径,
  构建备份目标路径,
};
