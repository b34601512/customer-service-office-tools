const fs = require('fs');
const path = require('path');
const { 截图目录, 规范化店铺标识 } = require('./paths');

function 格式化凭证时间(时间 = new Date()) {
  const 日期 = new Date(时间);
  if (Number.isNaN(日期.getTime())) {
    throw new Error('凭证时间无效。');
  }
  const 补齐两位 = (数值) => String(数值).padStart(2, '0');
  const 补齐三位 = (数值) => String(数值).padStart(3, '0');
  return `${日期.getFullYear()}${补齐两位(日期.getMonth() + 1)}${补齐两位(日期.getDate())}-${补齐两位(日期.getHours())}${补齐两位(日期.getMinutes())}${补齐两位(日期.getSeconds())}-${补齐三位(日期.getMilliseconds())}`;
}

function 规范化凭证名称(名称, 默认名称 = '未命名') {
  return String(名称 || 默认名称)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 默认名称;
}

function 构建凭证批次目录名称(执行类型, 开始时间) {
  return `${格式化凭证时间(开始时间)}-${规范化凭证名称(执行类型, '识别')}`;
}

function 创建凭证批次目录({ 执行类型 = '识别', 开始时间 = new Date() } = {}) {
  const 批次目录 = path.join(截图目录, 构建凭证批次目录名称(执行类型, 开始时间));
  fs.mkdirSync(批次目录, { recursive: true });
  return 批次目录;
}

function 构建店铺凭证路径({
  批次目录 = 截图目录,
  店铺 = {},
  开始时间 = new Date(),
  结果状态 = '成功',
  尝试次数 = 1,
  场景 = '',
} = {}) {
  const 店铺标识 = 规范化凭证名称(规范化店铺标识(店铺.id || 店铺.storeId), '未命名店铺');
  const 店铺名称 = 规范化凭证名称(店铺.name || 店铺.storeName, 店铺标识);
  const 场景文本 = 场景 ? `-${规范化凭证名称(场景)}` : '';
  const 尝试文本 = Number(尝试次数) > 1 ? `-第${Number(尝试次数)}次` : '';
  const 文件名 = `${店铺标识}-${店铺名称}-${格式化凭证时间(开始时间)}${场景文本}${尝试文本}-${规范化凭证名称(结果状态)}.png`;
  return path.join(批次目录, 文件名);
}

function 验证凭证文件(文件路径) {
  const 标准路径 = path.resolve(String(文件路径 || ''));
  if (!fs.existsSync(标准路径)) {
    throw new Error(`截图凭证未生成：${标准路径}`);
  }
  const 文件信息 = fs.statSync(标准路径);
  if (!文件信息.isFile() || 文件信息.size <= 0) {
    throw new Error(`截图凭证为空：${标准路径}`);
  }
  return 标准路径;
}

function 查找最近凭证批次目录() {
  if (!fs.existsSync(截图目录)) {
    fs.mkdirSync(截图目录, { recursive: true });
    return 截图目录;
  }
  const 批次目录列表 = fs.readdirSync(截图目录, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const 目录路径 = path.join(截图目录, entry.name);
      return { 目录路径, 修改时间: fs.statSync(目录路径).mtimeMs };
    })
    .sort((左侧, 右侧) => 右侧.修改时间 - 左侧.修改时间);
  return 批次目录列表[0]?.目录路径 || 截图目录;
}

function 读取凭证目录状态(目录路径 = 查找最近凭证批次目录()) {
  const 标准目录 = path.resolve(目录路径);
  if (!fs.existsSync(标准目录)) {
    return { directoryPath: 标准目录, fileCount: 0, exists: false };
  }
  const 文件数量 = fs.readdirSync(标准目录, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .length;
  return { directoryPath: 标准目录, fileCount: 文件数量, exists: true };
}

module.exports = {
  格式化凭证时间,
  规范化凭证名称,
  构建凭证批次目录名称,
  创建凭证批次目录,
  构建店铺凭证路径,
  验证凭证文件,
  查找最近凭证批次目录,
  读取凭证目录状态,
};
