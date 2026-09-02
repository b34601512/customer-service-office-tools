// 该文件用于解决天猫切店子模块聚合和对外接口注册问题。
const {
  normalizeTmallShopName,
  resolveExpectedTmallShopNames,
  isExpectedTmallShop
} = require("./storeSwitcherParts/tmallStoreNameText");
const { readCurrentTmallShopName } = require("./storeSwitcherParts/tmallCurrentShopReader");
const { ensureTmallActiveStore } = require("./storeSwitcherParts/tmallActiveStoreEnsurer");

module.exports = {
  normalizeTmallShopName,
  resolveExpectedTmallShopNames,
  isExpectedTmallShop,
  readCurrentTmallShopName,
  ensureTmallActiveStore
};
