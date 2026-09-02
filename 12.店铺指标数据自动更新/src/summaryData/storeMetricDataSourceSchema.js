const dataSourceSheetName = "数据源";
const dataSourceHeaderRowNumber = 1;
const dataSourceFirstDataRowNumber = 2;
const requiredDataSourceHeaders = [
  "采集日期", "平台", "店铺编号", "店铺名称", "指标名称", "指标数值",
  "单位", "原始统计窗口", "来源页面", "来源地址", "平台原始指标名", "记录键"
];

// 曾从这些来源页面采集的数据已整体换源，写入时由 writer 清除其在汇总表中的存量行。
const retiredDataSourcePages = ["京麦-接待数据"];

module.exports = {
  dataSourceSheetName,
  dataSourceHeaderRowNumber,
  dataSourceFirstDataRowNumber,
  requiredDataSourceHeaders,
  retiredDataSourcePages
};
