const fs = require('fs');
const path = require('path');

function 读取JSON文件(JSON路径) {
  // 解决：安全校验只读取目标分发包里的 JSON，不接触本机真实账号密码输出。
  if (!fs.existsSync(JSON路径)) {
    throw new Error(`分发包安全校验失败：缺少文件 ${JSON路径}`);
  }
  return JSON.parse(fs.readFileSync(JSON路径, 'utf8'));
}

function 是非空文本(值) {
  // 解决：把空字符串、null、undefined 统一视为空，避免误判模板字段。
  return String(值 ?? '').trim().length > 0;
}

function 收集目录文件路径(目录路径) {
  // 解决：递归确认登录态目录没有残留文件，避免把浏览器缓存和登录 Cookie 带出去。
  if (!fs.existsSync(目录路径)) {
    return [];
  }

  return fs.readdirSync(目录路径, { withFileTypes: true }).flatMap((目录项) => {
    const 子路径 = path.join(目录路径, 目录项.name);
    if (目录项.isDirectory()) {
      return 收集目录文件路径(子路径);
    }
    return [子路径];
  });
}

function 校验分发店铺配置不含敏感信息(分发目录) {
  // 解决：分发包只允许携带一个空白店铺模板，防止真实店铺、账号或密码外发。
  const 店铺配置路径 = path.join(分发目录, 'data', 'stores.json');
  const 店铺配置 = 读取JSON文件(店铺配置路径);
  const 店铺列表 = Array.isArray(店铺配置.stores) ? 店铺配置.stores : null;

  if (!店铺列表) {
    throw new Error('分发包安全校验失败：data/stores.json 的 stores 必须是数组。');
  }

  if (店铺列表.length !== 1) {
    throw new Error(`分发包安全校验失败：分发包只能包含 1 个空白店铺模板，当前数量=${店铺列表.length}。`);
  }

  店铺列表.forEach((店铺, 下标) => {
    const 序号 = 下标 + 1;
    if (是非空文本(店铺.username) || 是非空文本(店铺.password)) {
      throw new Error(`分发包安全校验失败：第 ${序号} 个店铺仍包含账号或密码，已阻止打包。`);
    }

    if (店铺.enabled === true) {
      throw new Error(`分发包安全校验失败：第 ${序号} 个店铺仍处于启用状态，已阻止打包。`);
    }
  });

  return {
    店铺数量: 店铺列表.length,
  };
}

function 校验分发运行目录不含登录态(分发目录) {
  // 解决：客服包只能带空目录，不能携带当前电脑上的浏览器登录态。
  const 需要保持空白的目录 = [
    path.join(分发目录, 'runtime', 'edge-profile'),
    path.join(分发目录, 'runtime', 'store-profiles'),
  ];
  const 残留文件列表 = 需要保持空白的目录.flatMap(收集目录文件路径);

  if (残留文件列表.length > 0) {
    throw new Error(`分发包安全校验失败：运行目录仍包含 ${残留文件列表.length} 个登录态或缓存文件，已阻止打包。`);
  }

  return {
    残留文件数量: 残留文件列表.length,
  };
}

function 校验客服分发包不含敏感数据(分发目录) {
  // 解决：在压缩前统一做隐私闸门，任何敏感信息残留都让打包直接失败。
  const 店铺校验结果 = 校验分发店铺配置不含敏感信息(分发目录);
  const 运行目录校验结果 = 校验分发运行目录不含登录态(分发目录);

  return {
    ...店铺校验结果,
    ...运行目录校验结果,
  };
}

module.exports = {
  校验客服分发包不含敏感数据,
  校验分发店铺配置不含敏感信息,
  校验分发运行目录不含登录态,
};
