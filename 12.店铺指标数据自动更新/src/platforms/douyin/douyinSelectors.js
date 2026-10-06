// 抖音后台「店铺名」头部元素选择器（单一出处）。
//
// 背景（2026-10-06 实测）：抖音后台改版后，店铺名元素由旧版裸类名 `headerShopName`
// 变成 CSS Modules 哈希类名（实测 `index_headerShopName__2wP1V`），
// 旧选择器 `.headerShopName` 命中 0 个 → 登录恢复循环永远认不出「已登录」，
// 一直等到超时报「等待人工登录超时」。
//
// 这里统一成兼容选择器：旧类名与新哈希类名都能命中。改版再次调整时只改这一处。
const DOUYIN_SHOP_HEADER_SELECTOR = ".headerShopName, [class*='headerShopName']";

module.exports = { DOUYIN_SHOP_HEADER_SELECTOR };
