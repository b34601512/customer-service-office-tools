const { 读取JSON文件, 写入JSON文件 } = require('../common/fs');
const { 店铺配置文件路径, 规范化店铺标识 } = require('../common/paths');

const 抖音默认登录地址 = 'https://fxg.jinritemai.com/';

function 读取手机号字段(原始配置 = {}) {
  // 解决：抖音登录只需要手机号，旧 username 字段仅作为兼容来源。
  return String(
    原始配置.phoneNumber
    || 原始配置.mobile
    || 原始配置.phone
    || 原始配置.username
    || ''
  ).trim();
}

function 规范化店铺配置(原始配置, 索引 = 0) {
  // 解决：把人工 JSON 配置收敛成后续流程能稳定使用的数据结构，支持同手机号多店切店。
  const 店铺名称 = String(原始配置?.name || 原始配置?.storeName || '').trim();
  if (!店铺名称) {
    throw new Error(`第 ${索引 + 1} 个店铺缺少名称。`);
  }
  const 店铺标识 = 规范化店铺标识(原始配置?.id || 店铺名称 || `store-${索引 + 1}`);
  if (!店铺标识) {
    throw new Error(`第 ${索引 + 1} 个店铺标识无效。`);
  }
  const phoneNumber = 读取手机号字段(原始配置);
  const platformStoreId = String(原始配置?.platformStoreId || 原始配置?.platformStoreID || 原始配置?.shopId || '').replace(/\D/g, '').trim();
  const platformStoreNameRaw = String(原始配置?.platformStoreName || '').trim();
  // 若未显式配置平台店名，尝试从 name 中去掉前缀编号后作为切店匹配名
  const platformStoreName = platformStoreNameRaw || String(店铺名称 || '').replace(/^抖音店铺\d+\s*/,'').trim();
  return {
    id: 店铺标识,
    name: 店铺名称,
    targetUrl: String(原始配置?.targetUrl || 抖音默认登录地址).trim() || 抖音默认登录地址,
    phoneNumber,
    username: phoneNumber,
    password: String(原始配置?.password || ''),
    platformStoreId,
    platformStoreName,
    enabled: 原始配置?.enabled !== false,
  };
}

function 校验店铺配置列表(店铺列表) {
  // 解决：多店铺必须先排除重复 id，否则登录资料目录会互相污染。
  const 已存在标识 = new Set();
  return (Array.isArray(店铺列表) ? 店铺列表 : []).map((店铺, 索引) => {
    const 标准店铺 = 规范化店铺配置(店铺, 索引);
    if (已存在标识.has(标准店铺.id)) {
      throw new Error(`店铺标识重复：${标准店铺.id}`);
    }
    已存在标识.add(标准店铺.id);
    return 标准店铺;
  });
}

function 检测重复账号配置(店铺列表 = []) {
  // 解决：同一手机号被两个店铺共用时，抖音服务端无法区分店铺，后台会显示同一店铺数据。
  const 账号计数 = new Map();
  for (const 店铺 of 店铺列表) {
    const 账号 = String(店铺.username || 店铺.phoneNumber || '').trim();
    if (!账号) continue;
    账号计数.set(账号, (账号计数.get(账号) || 0) + 1);
  }
  return Array.from(账号计数.entries()).filter(([, 数量]) => 数量 > 1).map(([账号]) => 账号);
}

function 读取店铺配置() {
  // 解决：所有入口统一读取同一份多店铺配置，避免命令行和后台将来分叉。
  const 原始配置 = 读取JSON文件(店铺配置文件路径, { stores: [] });
  return {
    stores: 校验店铺配置列表(原始配置.stores),
  };
}

function 保存店铺配置(配置) {
  // 解决：保存前统一校验配置，避免脏手机号进入登录流程。
  const 标准配置 = {
    stores: 校验店铺配置列表(配置?.stores),
  };
  写入JSON文件(店铺配置文件路径, 标准配置);
  return 标准配置;
}

function 获取启用店铺列表() {
  // 解决：批量登录只处理启用店铺，测试店铺可以保留但不误跑。
  return 读取店铺配置().stores.filter((店铺) => 店铺.enabled);
}

function 获取指定或首个启用店铺(storeId = '') {
  // 解决：命令行既支持指定店铺，也支持默认跑第一家启用店铺。
  const 店铺列表 = 获取启用店铺列表();
  if (!店铺列表.length) {
    throw new Error('没有启用中的抖音店铺，请先编辑 data/stores.json。');
  }
  const 指定标识 = String(storeId || '').trim();
  if (!指定标识) {
    return 店铺列表[0];
  }
  const 店铺 = 店铺列表.find((当前店铺) => 当前店铺.id === 指定标识);
  if (!店铺) {
    throw new Error(`没有找到启用店铺：${指定标识}`);
  }
  return 店铺;
}

module.exports = {
  抖音默认登录地址,
  读取手机号字段,
  规范化店铺配置,
  校验店铺配置列表,
  检测重复账号配置,
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
  获取指定或首个启用店铺,
};
