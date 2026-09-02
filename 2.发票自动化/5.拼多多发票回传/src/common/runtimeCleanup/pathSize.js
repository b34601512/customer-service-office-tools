const fs = require('fs');
const path = require('path');

function 计算路径大小字节(目标路径) {
  // 解决：迁移前统计路径体积，方便日志展示清理效果。
  if (!fs.existsSync(目标路径)) {
    return 0;
  }

  const 文件状态 = fs.lstatSync(目标路径);
  if (!文件状态.isDirectory()) {
    return 文件状态.size;
  }

  return fs.readdirSync(目标路径, { withFileTypes: true }).reduce((总大小, entry) => {
    const 子路径 = path.join(目标路径, entry.name);
    if (entry.isSymbolicLink()) {
      return 总大小;
    }
    return 总大小 + 计算路径大小字节(子路径);
  }, 0);
}

module.exports = {
  计算路径大小字节,
};
