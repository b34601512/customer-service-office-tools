const { 读取JSON文件, 写入JSON文件 } = require('../common/fs');
const { 店铺配置文件路径, 规范化店铺标识 } = require('../common/paths');

const 默认目标页面地址 = 'https://sz.jd.com/szweb/sz/view/serviceAnalysis/createInvoiceGovernance.html';

function 构建默认店铺配置() {
  // 解决：让旧的单店铺入口在没有后台配置时也能继续工作。
  return {
    id: 'default-store',
    name: '默认店铺',
    targetUrl: 默认目标页面地址,
    username: '',
    password: '',
    enabled: true,
  };
}

function 规范化店铺配置(原始配置, 索引 = 0) {
  // 解决：把后台提交的任意店铺表单收敛成稳定结构，避免后续流程面对脏数据。
  const 店铺名称 = String(原始配置?.name || 原始配置?.storeName || '').trim();
  if (!店铺名称) {
    throw new Error(`第 ${索引 + 1} 个店铺缺少名称。`);
  }

  return {
    id: 规范化店铺标识(原始配置?.id || 店铺名称 || `store-${索引 + 1}`),
    name: 店铺名称,
    targetUrl: String(原始配置?.targetUrl || 默认目标页面地址).trim() || 默认目标页面地址,
    username: String(原始配置?.username || '').trim(),
    password: String(原始配置?.password || ''),
    enabled: 原始配置?.enabled !== false,
  };
}

function 校验店铺配置列表(店铺列表) {
  // 解决：保存配置前统一检查重复 id，避免多店铺浏览器档案和快照串号。
  const 已存在标识 = new Set();
  return 店铺列表.map((店铺, 索引) => {
    const 规范店铺 = 规范化店铺配置(店铺, 索引);
    if (已存在标识.has(规范店铺.id)) {
      throw new Error(`店铺标识重复：${规范店铺.id}`);
    }
    已存在标识.add(规范店铺.id);
    return 规范店铺;
  });
}

function 读取店铺配置() {
  // 解决：后台首页和巡检任务统一从这里读取多店铺配置。
  const 原始配置 = 读取JSON文件(店铺配置文件路径, {
    stores: [构建默认店铺配置()],
  });
  const 店铺列表 = Array.isArray(原始配置.stores) && 原始配置.stores.length > 0
    ? 校验店铺配置列表(原始配置.stores)
    : [构建默认店铺配置()];

  return {
    stores: 店铺列表,
  };
}

function 保存店铺配置(配置) {
  // 解决：统一保存多店铺配置，并在落盘前完成结构校验。
  const 店铺列表 = Array.isArray(配置?.stores) ? 校验店铺配置列表(配置.stores) : [];
  const 标准配置 = {
    stores: 店铺列表,
  };
  写入JSON文件(店铺配置文件路径, 标准配置);
  return 标准配置;
}

function 获取启用店铺列表() {
  // 解决：批量任务只处理启用中的店铺，避免测试店铺被误跑。
  return 读取店铺配置().stores.filter((店铺) => 店铺.enabled);
}

module.exports = {
  默认目标页面地址,
  构建默认店铺配置,
  规范化店铺配置,
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
};
