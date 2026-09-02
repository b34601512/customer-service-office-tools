const fs = require('fs');
const path = require('path');
const { 构建备份目标路径, 生成不冲突路径 } = require('./backupPath');

function 迁移到备份目录(目标路径, 选项 = {}) {
  // 解决：用迁移代替删除，保证运行垃圾清走后仍可追溯。
  if (!fs.existsSync(目标路径)) {
    return null;
  }

  const 备份路径 = 生成不冲突路径(构建备份目标路径(目标路径, 选项));
  fs.mkdirSync(path.dirname(备份路径), { recursive: true });
  fs.renameSync(目标路径, 备份路径);
  return 备份路径;
}

module.exports = {
  迁移到备份目录,
};
