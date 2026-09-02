const fs = require('fs');
const path = require('path');
const { 项目根目录 } = require('../common/paths');
const { 读取打包配置, 读取发布信息 } = require('../common/releaseInfo');

function 递增显示版本(当前显示版本) {
  // 解决：只递增末尾数字段，避免把 0.03 当浮点数计算导致版本号失真。
  const 版本文本 = String(当前显示版本 ?? '').trim();
  if (!版本文本) {
    throw new Error('当前显示版本为空，无法自动递增版本号。');
  }

  const 匹配结果 = 版本文本.match(/^(.*?)(\d+)$/);
  if (!匹配结果) {
    throw new Error(`当前显示版本无法自动递增：${版本文本}，版本号末尾必须是数字。`);
  }

  const [, 版本前缀, 末尾数字文本] = 匹配结果;
  const 新末尾数字文本 = (BigInt(末尾数字文本) + 1n)
    .toString()
    .padStart(末尾数字文本.length, '0');
  return `${版本前缀}${新末尾数字文本}`;
}

function 创建自动递增发布计划(projectRoot = 项目根目录) {
  // 解决：打包入口统一先算出当前版本和本次新版本，避免每次重复打出旧版本包。
  const 当前发布信息 = 读取发布信息(projectRoot, {
    严格校验打包配置: true,
  });
  const 当前打包配置 = 读取打包配置(projectRoot, {
    允许缺失: false,
  });
  const 新显示版本 = 递增显示版本(当前发布信息.显示版本);

  return {
    当前发布信息,
    新发布信息: {
      ...当前发布信息,
      显示版本: 新显示版本,
    },
    新打包配置: {
      ...当前打包配置,
      displayVersion: 新显示版本,
    },
  };
}

function 写入项目打包配置(打包配置, projectRoot = 项目根目录) {
  // 解决：版本递增后立刻持久化到唯一配置文件，确保下次打包继续从新版本递增。
  if (!打包配置 || typeof 打包配置 !== 'object' || Array.isArray(打包配置)) {
    throw new Error('写入打包配置失败：打包配置必须是对象。');
  }

  const 打包配置路径 = path.join(projectRoot, '打包配置.json');
  fs.writeFileSync(打包配置路径, `${JSON.stringify(打包配置, null, 2)}\n`, 'utf8');
  return 打包配置路径;
}

module.exports = {
  创建自动递增发布计划,
  写入项目打包配置,
  递增显示版本,
};
