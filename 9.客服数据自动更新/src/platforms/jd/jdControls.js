const { buildButtonTextPattern } = require("../../shared/visibleButtonActionEngine");

function getJdSearchButton(surface) {
  return surface
    .locator("button, a, [role='button']")
    .filter({ hasText: buildButtonTextPattern(["搜索", "查询"]) })
    .first();
}

function getJdExportButton(surface) {
  return surface
    .locator("button, a, [role='button']")
    .filter({ hasText: buildButtonTextPattern(["导出", "导出数据", "导出excel"]) })
    .first();
}

function getJdDateRangeEditors(surface) {
  // 这里优先锁定日期范围组件本体，避免把店铺、客服组、昵称等普通输入框错认成日期控件。
  return surface.locator(
    [
      ".el-date-editor--daterange",
      ".el-range-editor",
      ".ant-picker-range",
      ".kf-manage-lite-picker-range",
      "[class*='date-range']",
      "[class*='range-picker']"
    ].join(", ")
  );
}

module.exports = {
  getJdSearchButton,
  getJdExportButton,
  getJdDateRangeEditors
};
