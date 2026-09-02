const assert = require("assert");
const { DOMParser } = require("@xmldom/xmldom");
const {
  getPlatformReportRule
} = require("../src/config/platformReportRuleParts/platformReportRuleService");
const {
  createDefaultProjectConfig
} = require("../src/config/projectConfigDefaults");
const {
  normalizeProjectConfigPayload
} = require("../src/config/projectConfigServiceParts/projectConfigNormalization");
const {
  shouldPersistReportProfileNormalization
} = require("../src/config/projectConfigServiceParts/projectConfigMigrationDetection");
const {
  buildResponseTotals
} = require("../src/summaryData/summaryDataRows");
const {
  buildDetailRowElement,
  ensureThirtySecondMetricWorksheetColumns,
  ensureThirtySecondMetricTableColumns
} = require("../src/summaryData/summaryDataWriter");
const {
  listElements,
  findFirstElement
} = require("../src/summaryData/xlsxWorkbookEngine");

const legacyDetailHeaders = [
  "统计开始日", "统计结束日", "统计粒度", "平台", "店铺编号", "店铺名称", "客服姓名",
  "客服岗位", "销售额", "询单人数", "下单人数", "接待会话量", "响应总秒数",
  "3分钟内响应会话量", "满意评价量", "评价量", "来源文件", "导入时间",
  "转化率", "平均响应时长（秒）", "3分钟响应率", "满意率"
];

function findMetricMapping(platformKey, sourceFieldLabel) {
  const reportRule = getPlatformReportRule(platformKey, "response_time", platformKey === "tmall" ? "single_file" : "system");
  return reportRule?.metricMappings.find(
    (metricMapping) => metricMapping.key === "thirty_second_response_rate"
  )?.sourceFieldLabel === sourceFieldLabel;
}

function testPlatformFieldRules() {
  assert.strictEqual(findMetricMapping("jd", "30s应答率"), true);
  assert.strictEqual(findMetricMapping("pdd", "30秒应答率(8-23点)"), true);
  assert.strictEqual(findMetricMapping("tmall", ""), false);
  assert.strictEqual(findMetricMapping("douyin", ""), false);
}

function testThirtySecondWeightedTotals() {
  const totals = buildResponseTotals({
    response_weight: 200,
    avg_response_time: 12,
    three_minute_response_rate: 0.98,
    thirty_second_response_rate: 0.875
  });
  assert.strictEqual(totals.thirtySecondWithinCount, 175);
  assert.strictEqual(buildResponseTotals({ response_weight: 20 }).thirtySecondWithinCount, null);
  const missingWeightTotals = buildResponseTotals({
    avg_response_time: 12,
    three_minute_response_rate: 0.9,
    thirty_second_response_rate: 0.9
  });
  assert.strictEqual(missingWeightTotals.responseTotalSeconds, null);
  assert.strictEqual(missingWeightTotals.threeMinuteWithinCount, null);
  assert.strictEqual(missingWeightTotals.thirtySecondWithinCount, null);
}

function removeThirtySecondMappings(projectConfig) {
  ["jd", "pdd"].forEach((platformKey) => {
    projectConfig[platformKey].stores.forEach((store) => {
      store.reportProfiles.response_time.metricMappings =
        store.reportProfiles.response_time.metricMappings.filter(
          (metricMapping) => metricMapping.key !== "thirty_second_response_rate"
        );
    });
  });
}

function testHistoricalConfigReceivesNewOfficialMapping() {
  const historicalConfig = createDefaultProjectConfig(new Date(2026, 7, 1));
  removeThirtySecondMappings(historicalConfig);
  assert.strictEqual(shouldPersistReportProfileNormalization(historicalConfig), true);
  const normalizedConfig = normalizeProjectConfigPayload(historicalConfig);
  assert.strictEqual(findMetricMappingInStore(normalizedConfig.jd.stores[0]), "30s应答率");
  assert.strictEqual(findMetricMappingInStore(normalizedConfig.pdd.stores[0]), "30秒应答率(8-23点)");
  assert.strictEqual(findMetricMappingInStore(normalizedConfig.tmall.stores[0]), "");
  assert.strictEqual(findMetricMappingInStore(normalizedConfig.douyin.stores[0]), "");
}

function findMetricMappingInStore(store) {
  return store.reportProfiles.response_time.metricMappings.find(
    (metricMapping) => metricMapping.key === "thirty_second_response_rate"
  )?.sourceFieldLabel || "";
}

function buildSharedStringStore(values = []) {
  return {
    values,
    getIndex(value) {
      const existingIndex = this.values.indexOf(value);
      if (existingIndex >= 0) {
        return existingIndex;
      }
      this.values.push(value);
      return this.values.length - 1;
    }
  };
}

function findCell(rowElement, reference) {
  return listElements(rowElement, "c").find((cellElement) => cellElement.getAttribute("r") === reference);
}

function readElementText(parentElement, localName) {
  return findFirstElement(parentElement, localName)?.textContent || "";
}

function testDetailRowWritesThirtySecondMetric() {
  const document = new DOMParser().parseFromString(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    "application/xml"
  );
  const rowElement = buildDetailRowElement(document, {
    periodStart: 46000,
    periodEnd: 46029,
    periodGranularity: "统计期间",
    platform: "京东",
    storeKey: "jd1",
    storeName: "京东1店",
    personName: "测试客服",
    salesAmount: 100,
    inquiryCount: 10,
    orderCount: 2,
    responseWeight: 100,
    responseTotalSeconds: 1200,
    threeMinuteWithinCount: 98,
    satisfiedCount: 5,
    evaluationCount: 5,
    sourceFiles: "source.xlsx",
    importedAt: 46030,
    thirtySecondWithinCount: 87
  }, 5, {}, buildSharedStringStore());
  assert.strictEqual(rowElement.getAttribute("spans"), "1:24");
  assert.strictEqual(readElementText(findCell(rowElement, "W5"), "v"), "87");
  assert.strictEqual(
    readElementText(findCell(rowElement, "X5"), "f"),
    'IF(OR(W5="",L5="",L5=0),"",W5/L5)'
  );
  assert.strictEqual(readElementText(findCell(rowElement, "X5"), "v"), "0.87");

  const emptyMetricRowElement = buildDetailRowElement(document, {
    periodStart: 46000,
    periodEnd: 46029,
    periodGranularity: "统计期间",
    platform: "天猫",
    storeKey: "tmall1",
    storeName: "天猫1店",
    personName: "测试客服",
    responseWeight: 100,
    sourceFiles: "source.xlsx",
    importedAt: 46030,
    thirtySecondWithinCount: null
  }, 6, {}, buildSharedStringStore());
  assert.strictEqual(readElementText(findCell(emptyMetricRowElement, "W6"), "v"), "");
  assert.strictEqual(readElementText(findCell(emptyMetricRowElement, "X6"), "v"), "");
}

function testLegacyWorksheetSchemaUpgrade() {
  const document = new DOMParser().parseFromString(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:V4"/><cols><col min="1" max="22" width="12" customWidth="1"/></cols><sheetData><row r="4" spans="1:22"/></sheetData><mergeCells count="2"><mergeCell ref="A1:V1"/><mergeCell ref="A2:V2"/></mergeCells></worksheet>',
    "application/xml"
  );
  const headerCells = new Map(
    legacyDetailHeaders.map((header, index) => [index + 1, { value: header, styleIndex: 5 }])
  );
  const sharedStrings = buildSharedStringStore([...legacyDetailHeaders]);
  const changed = ensureThirtySecondMetricWorksheetColumns(
    document,
    new Map([[4, headerCells]]),
    sharedStrings
  );
  const headerRowElement = listElements(document, "row")[0];
  assert.strictEqual(changed, true);
  assert.strictEqual(headerRowElement.getAttribute("spans"), "1:24");
  assert.ok(findCell(headerRowElement, "W4"));
  assert.ok(findCell(headerRowElement, "X4"));
  assert.deepStrictEqual(
    listElements(document, "mergeCell").map((mergeCell) => mergeCell.getAttribute("ref")),
    ["A1:X1", "A2:X2"]
  );
}

function testLegacyTableSchemaUpgradeIsIdempotent() {
  const tableColumnsXml = legacyDetailHeaders.map(
    (header, index) => `<tableColumn id="${index + 1}" name="${header}"/>`
  ).join("");
  const tableDocument = new DOMParser().parseFromString(
    `<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><autoFilter ref="A4:V4"/><tableColumns count="22">${tableColumnsXml}</tableColumns></table>`,
    "application/xml"
  );
  ensureThirtySecondMetricTableColumns(tableDocument);
  ensureThirtySecondMetricTableColumns(tableDocument);
  const tableColumnElements = listElements(tableDocument, "tableColumn");
  assert.strictEqual(tableColumnElements.length, 24);
  assert.strictEqual(findFirstElement(tableDocument, "tableColumns").getAttribute("count"), "24");
  assert.deepStrictEqual(
    tableColumnElements.slice(-2).map((columnElement) => columnElement.getAttribute("name")),
    ["30秒内应答会话量", "30秒应答率"]
  );
}

function run() {
  testPlatformFieldRules();
  testThirtySecondWeightedTotals();
  testHistoricalConfigReceivesNewOfficialMapping();
  testDetailRowWritesThirtySecondMetric();
  testLegacyWorksheetSchemaUpgrade();
  testLegacyTableSchemaUpgradeIsIdempotent();
  console.log("PASS 京东/拼多多30秒应答率会写入汇总，天猫/抖音保持空白");
}

run();
