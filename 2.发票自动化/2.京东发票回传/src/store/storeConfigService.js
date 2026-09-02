const { 读取JSON文件, 写入JSON文件 } = require('../common/fs');
const { 店铺配置文件路径, 规范化店铺标识 } = require('../common/paths');
const { 目标页面地址 } = require('../browser/targetPageIdentity');
const { 默认接口每页条数, 规范化接口每页条数 } = require('../consumerInvoice/invoiceApiPageSize');

const 默认目标页面地址 = 目标页面地址;
const 默认申请时间最近天数 = 30;
const 客服姓名字数上限 = 30;

function 规范化申请时间最近天数(value) {
  // 解决：申请时间筛选必须有稳定默认值，避免旧配置升级后继续全量扫近3个月。
  const numberValue = Number.parseInt(value, 10);
  if (!Number.isFinite(numberValue)) {
    return 默认申请时间最近天数;
  }
  if (numberValue < 1 || numberValue > 365) {
    throw new Error('申请时间最近天数必须在 1 到 365 之间。');
  }
  return numberValue;
}

function 规范化客服姓名(value, 索引 = 0) {
  // 解决：客服姓名会进入订单导出表，保存前先清洗避免空值和超长文本污染后续表格。
  const 姓名 = String(value || '').trim();
  if (!姓名) {
    throw new Error(`第 ${索引 + 1} 个客服姓名不能为空。`);
  }
  if (姓名.length > 客服姓名字数上限) {
    throw new Error(`第 ${索引 + 1} 个客服姓名不能超过 ${客服姓名字数上限} 个字。`);
  }
  return 姓名;
}

function 校验客服姓名列表(客服姓名列表) {
  // 解决：客服选项必须唯一，避免同名选项导出后无法判断真实负责人。
  const 已存在姓名 = new Set();
  return 客服姓名列表
    .map((姓名, 索引) => 规范化客服姓名(姓名, 索引))
    .filter((姓名) => {
      if (已存在姓名.has(姓名)) return false;
      已存在姓名.add(姓名);
      return true;
    });
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
    applicationDateRangeDays: 规范化申请时间最近天数(原始配置?.applicationDateRangeDays),
    pageSize: 规范化接口每页条数(原始配置?.pageSize ?? 默认接口每页条数),
  };
}

function 校验店铺配置列表(店铺列表) {
  // 解决：保存配置前统一检查重复 id，避免多店铺登录态和快照串号。
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
    stores: [],
    customerServiceNames: [],
  });
  const 店铺列表 = Array.isArray(原始配置.stores) && 原始配置.stores.length > 0
    ? 校验店铺配置列表(原始配置.stores)
    : [];

  return {
    stores: 店铺列表,
    customerServiceNames: Array.isArray(原始配置.customerServiceNames)
      ? 校验客服姓名列表(原始配置.customerServiceNames)
      : [],
  };
}

function 保存店铺配置(配置) {
  // 解决：统一保存多店铺配置，并在落盘前完成结构校验。
  const 店铺列表 = Array.isArray(配置?.stores) ? 校验店铺配置列表(配置.stores) : [];
  const 客服姓名列表 = Array.isArray(配置?.customerServiceNames) ? 校验客服姓名列表(配置.customerServiceNames) : [];
  const 标准配置 = {
    stores: 店铺列表,
    customerServiceNames: 客服姓名列表,
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
  默认申请时间最近天数,
  默认接口每页条数,
  客服姓名字数上限,
  规范化店铺配置,
  规范化客服姓名,
  读取店铺配置,
  保存店铺配置,
  获取启用店铺列表,
};
