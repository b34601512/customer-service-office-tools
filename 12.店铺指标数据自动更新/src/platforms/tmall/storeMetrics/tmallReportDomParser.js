const { shiftDate } = require("./tmallReportPayloadParser");

const scoreMetricDefinitions = [
  ["真实体验分", "nps", "综合得分"],
  ["宝贝质量", "newGoods", "维度得分"],
  ["物流速度", "newLogistics", "维度得分"],
  ["服务保障", "newServices", "维度得分"]
];

const assessmentMetricDefinitions = [
  ["商品负反馈率", "宝贝质量"],
  ["商品好评率", "宝贝质量"],
  ["48小时揽收及时率", "物流速度"],
  ["物流到货时长", "物流速度"],
  ["3分钟人工响应率", "服务保障"],
  ["旺旺满意度", "服务保障"],
  ["退款处理时长", "服务保障"],
  ["平台求助率", "服务保障"],
  ["当日/次日达订单占比", "附加分"]
];

function findMetricLineIndex(lines, metricName) {
  return lines.findIndex((line) => line === metricName || line.startsWith(metricName));
}

function parseNearbyMetricValue(lines, metricName) {
  const matchingIndexes = lines
    .map((line, lineIndex) => line === metricName || line.startsWith(metricName) ? lineIndex : -1)
    .filter((lineIndex) => lineIndex >= 0);
  for (const startIndex of matchingIndexes) {
    for (const line of lines.slice(startIndex + 1, startIndex + 6)) {
      const valueMatch = line.match(/^([0-9][0-9,]*(?:\.[0-9]+)?)(%|小时)?$/);
      if (!valueMatch) continue;
      const numericValue = Number(valueMatch[1].replace(/,/g, ""));
      if (!Number.isFinite(numericValue)) continue;
      return {
        value: valueMatch[2] === "%" ? numericValue / 100 : numericValue,
        unit: valueMatch[2] || ""
      };
    }
  }
  return null;
}

async function readTmallReportDomSnapshot(page) {
  const dateInput = page.locator('input[placeholder="选择日期"]').first();
  const dataDate = await dateInput.inputValue({ timeout: 10000 });
  const bodyText = await page.locator("body").innerText({ timeout: 10000 });
  const lines = bodyText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const indicatorList = scoreMetricDefinitions.flatMap(([metricName, code]) => {
    const parsedMetric = parseNearbyMetricValue(lines, metricName);
    return parsedMetric ? [{ code, name: metricName, score: String(parsedMetric.value) }] : [];
  });
  const mainIndexByCategory = new Map();
  for (const [metricName, category] of assessmentMetricDefinitions) {
    const parsedMetric = parseNearbyMetricValue(lines, metricName);
    if (!parsedMetric) continue;
    if (!mainIndexByCategory.has(category)) {
      mainIndexByCategory.set(category, { name: category, subIndexInfoList: [] });
    }
    mainIndexByCategory.get(category).subIndexInfoList.push({
      name: metricName,
      value: String(parsedMetric.value),
      showValue: parsedMetric.unit === "%" ? `${parsedMetric.value * 100}%` : `${parsedMetric.value}${parsedMetric.unit}`,
      unit: parsedMetric.unit,
      indexDesc: { interval: `页面近30天DOM兜底，${shiftDate(dataDate, -29)}~${dataDate}` }
    });
  }
  return {
    dataDate,
    statisticsStartDate: shiftDate(dataDate, -29),
    statisticsEndDate: dataDate,
    indicatorData: { list: indicatorList },
    summaryData: { mainIndexInfoList: [...mainIndexByCategory.values()] }
  };
}

module.exports = {
  scoreMetricDefinitions,
  assessmentMetricDefinitions,
  findMetricLineIndex,
  parseNearbyMetricValue,
  readTmallReportDomSnapshot
};
