const detailSheetName = "数据明细";
// 下面两行只描述本地 .xlsx 模板；在线 AirScript 会把收到的 A:X 明细直接覆盖到目标工作表。
const detailHeaderRowNumber = 4;
const detailFirstDataRowNumber = 5;
const thirtySecondWithinCountHeader = "30秒内应答会话量";
const thirtySecondResponseRateHeader = "30秒应答率";

const legacyRequiredHeaders = [
  "统计开始日", "统计结束日", "统计粒度", "平台", "店铺编号", "店铺名称", "客服姓名",
  "客服岗位", "销售额", "询单人数", "下单人数", "接待会话量", "响应总秒数",
  "3分钟内响应会话量", "满意评价量", "评价量", "来源文件", "导入时间",
  "转化率", "平均响应时长（秒）", "3分钟响应率", "满意率"
];
const requiredHeaders = [
  ...legacyRequiredHeaders,
  thirtySecondWithinCountHeader,
  thirtySecondResponseRateHeader
];

module.exports = {
  detailSheetName,
  detailHeaderRowNumber,
  detailFirstDataRowNumber,
  legacyRequiredHeaders,
  requiredHeaders,
  thirtySecondWithinCountHeader,
  thirtySecondResponseRateHeader
};
