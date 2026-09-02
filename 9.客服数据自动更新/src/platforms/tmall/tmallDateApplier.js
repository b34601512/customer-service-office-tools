// 该文件用于解决天猫日期区间设置的入口调度和对外接口注册问题。
const { log } = require("../../engine/logger");
const { applyTmallDateRangeByDomScript } = require("./dateApplierParts/tmallDateDomScript");
const { waitForTmallPageDateApplied } = require("./dateApplierParts/tmallDatePageVerification");

async function applyTmallDateRange(page, range) {
  // 这里保留对外入口不变，内部只走页面脚本直达这一条日期选择路线。
  if (!range?.startDate || !range?.endDate || !range?.startText || !range?.endText) {
    throw new Error("天猫日期区间不能为空。");
  }

  log("主线:执行", "天猫日期", "脚本直达", `准备设置日期范围：${range.startText} 到 ${range.endText}`);
  await applyTmallDateRangeByDomScript(page, range);
  const pageText = await waitForTmallPageDateApplied(page, range);
  log("主线:完成", "天猫日期", "页面验收", `页面日期文本=${pageText}`);
  return range;
}

module.exports = {
  applyTmallDateRange
};
