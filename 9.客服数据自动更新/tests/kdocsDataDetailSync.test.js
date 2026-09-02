const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createDefaultProjectConfig } = require("../src/config/projectConfigDefaults");
const { normalizeProjectConfigPayload } = require("../src/config/projectConfigServiceParts/projectConfigNormalization");
const { requiredHeaders } = require("../src/summaryData/summaryDataDetailSchema");
const {
  buildDataDetailMatrix,
  excelDateSerialToText,
  normalizeKdocsCellValue,
  normalizeKdocsDataDetailRows
} = require("../src/kdocsSync/dataDetailWorkbookReader");
const {
  requireValidKdocsDocumentUrl,
  requireValidKdocsWebhookUrl,
  isKdocsSyncConfigured
} = require("../src/kdocsSync/kdocsSyncSettings");
const { executeKdocsAirScriptSync } = require("../src/kdocsSync/kdocsAirScriptClient");
const {
  KDOCS_SYNC_AIRSCRIPT_VERSION,
  KDOCS_FILTER_AIRSCRIPT_VERSION,
  KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION,
  KDOCS_FULL_SYNC_OPERATION,
  KDOCS_PIVOT_FILTER_OPERATION,
  KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
  requireCurrentKdocsAirScriptVersion,
  parseKdocsDataRangeAddress,
  buildKdocsPivotSourceData,
  isExpectedKdocsPivotSourceData,
  sanitizeKdocsDiagnosticText
} = require("../src/kdocsSync/kdocsSyncContract");
const {
  syncDataDetailToKdocs
} = require("../src/kdocsSync/syncDataDetailToKdocs");
const {
  appendKdocsSyncReceipt,
  readKdocsSyncReceiptHistory,
  sanitizeReceiptValue
} = require("../src/kdocsSync/kdocsSyncReceiptStore");
const {
  isValidPivotFilterDate,
  requireValidPivotFilterDate,
  resolvePivotFilterDateInput,
  resolveExcelDateSerial,
  updateKdocsPivotEndDateFilter
} = require("../src/kdocsSync/updateKdocsPivotEndDateFilter");
const {
  reapplyKdocsCustomerServiceNameFilter
} = require("../src/kdocsSync/reapplyKdocsCustomerServiceNameFilter");
const {
  airScriptTemplatePath,
  airScriptSyncTemplatePath,
  airScriptFilterTemplatePath,
  airScriptCustomerServiceNameTemplatePath,
  renderKdocsSyncInstructions,
  renderKdocsSyncStatusInstructions
} = require("../src/cli/cliKdocsSyncMenu");
const { createKdocsPage } = require("../src/cli/tui/pages/kdocs");

const testDocumentUrl = "https://www.kdocs.cn/l/example-document";
const testWebhookUrl = (
  "https://www.kdocs.cn/api/v3/ide/file/example-file/script/example-script/sync_task"
);
const testFilterWebhookUrl = (
  "https://www.kdocs.cn/api/v3/ide/file/example-file/script/filter-script/sync_task"
);
const testCustomerServiceNameWebhookUrl = (
  "https://www.kdocs.cn/api/v3/ide/file/example-file/script/customer-service-name-script/sync_task"
);
const expectedSyncAirScriptVersion = "2026-08-07.8";
const expectedFilterAirScriptVersion = "2026-08-11.1";

function testCurrentAirScriptVersionContract() {
  assert.strictEqual(KDOCS_SYNC_AIRSCRIPT_VERSION, expectedSyncAirScriptVersion);
  assert.strictEqual(KDOCS_FILTER_AIRSCRIPT_VERSION, expectedFilterAirScriptVersion);
  assert.strictEqual(KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION, expectedSyncAirScriptVersion);
  assert.strictEqual(airScriptTemplatePath, airScriptSyncTemplatePath);
  const syncScriptText = fs.readFileSync(airScriptSyncTemplatePath, "utf8");
  assert.deepStrictEqual(
    [...syncScriptText.matchAll(/const scriptVersion = ['"]([^'"]+)['"]/g)].map((match) => match[1]),
    [expectedSyncAirScriptVersion]
  );
  const filterScriptText = fs.readFileSync(airScriptFilterTemplatePath, "utf8");
  assert.deepStrictEqual(
    [...filterScriptText.matchAll(/const scriptVersion = ['"]([^'"]+)['"]/g)].map((match) => match[1]),
    [expectedFilterAirScriptVersion]
  );
  const customerServiceNameScriptText = fs.readFileSync(airScriptCustomerServiceNameTemplatePath, "utf8");
  assert.deepStrictEqual(
    [...customerServiceNameScriptText.matchAll(/const scriptVersion = ['"]([^'"]+)['"]/g)].map((match) => match[1]),
    [expectedSyncAirScriptVersion]
  );
  const lineCount = filterScriptText.split(/\r?\n/).length - 1;
  assert.ok(lineCount <= 30);
  assert.doesNotThrow(() => new Function("Application", "Context", "console", filterScriptText));
  assert.doesNotThrow(() => new Function("Application", "Context", "console", syncScriptText));
  assert.doesNotThrow(() => new Function("Application", "Context", "console", customerServiceNameScriptText));
}

function buildWorksheetRow(values) {
  return new Map(values.map((value, columnOffset) => [columnOffset + 1, { value }]));
}

function buildDataRow(personName, endDateSerial, suffix = "") {
  const dataRow = Array(24).fill("");
  dataRow[0] = endDateSerial;
  dataRow[1] = endDateSerial;
  dataRow[2] = "统计期间";
  dataRow[3] = "测试平台";
  dataRow[4] = `store-${suffix || personName}`;
  dataRow[5] = `测试店铺${suffix}`;
  dataRow[6] = personName;
  dataRow[17] = endDateSerial + 0.5;
  return dataRow;
}

function buildLocalDataDetail(dataRows) {
  const worksheetRows = new Map([[4, buildWorksheetRow(requiredHeaders)]]);
  dataRows.forEach((dataRow, rowOffset) => {
    worksheetRows.set(5 + rowOffset, buildWorksheetRow(dataRow));
  });
  return buildDataDetailMatrix(worksheetRows);
}

function buildConfiguredProjectConfig() {
  const projectConfig = createDefaultProjectConfig(new Date(2026, 7, 4));
  projectConfig.workbook.path = "D:\\test-workbook.xlsx";
  projectConfig.kdocsDataDetailSync = {
    documentUrl: testDocumentUrl,
    syncWebhookUrl: testWebhookUrl,
    syncApiToken: "test-sync-token",
    filterWebhookUrl: testFilterWebhookUrl,
    filterApiToken: "test-filter-token",
    customerServiceNameWebhookUrl: testCustomerServiceNameWebhookUrl,
    customerServiceNameApiToken: "test-customer-service-name-token"
  };
  return projectConfig;
}

function testProjectConfigDefaults() {
  const defaultConfig = createDefaultProjectConfig(new Date(2026, 7, 4));
  assert.deepStrictEqual(defaultConfig.kdocsDataDetailSync, {
    documentUrl: "",
    syncWebhookUrl: "",
    syncApiToken: "",
    filterWebhookUrl: "",
    filterApiToken: "",
    customerServiceNameWebhookUrl: "",
    customerServiceNameApiToken: ""
  });
  const normalizedConfig = normalizeProjectConfigPayload({
    ...defaultConfig,
    kdocsDataDetailSync: undefined
  });
  assert.deepStrictEqual(normalizedConfig.kdocsDataDetailSync, defaultConfig.kdocsDataDetailSync);
}

function testKdocsSettingValidation() {
  assert.strictEqual(requireValidKdocsDocumentUrl(testDocumentUrl), testDocumentUrl);
  assert.strictEqual(requireValidKdocsWebhookUrl(testWebhookUrl), testWebhookUrl);
  assert.strictEqual(
    isKdocsSyncConfigured({
      documentUrl: testDocumentUrl,
      syncWebhookUrl: testWebhookUrl,
      syncApiToken: "test-sync-token",
      filterWebhookUrl: testFilterWebhookUrl,
      filterApiToken: "test-filter-token"
    }),
    true
  );
  assert.strictEqual(
    isKdocsSyncConfigured({ documentUrl: testDocumentUrl, syncWebhookUrl: testWebhookUrl, syncApiToken: "" }),
    false
  );
  assert.strictEqual(
    isKdocsSyncConfigured({ documentUrl: testDocumentUrl, filterWebhookUrl: testFilterWebhookUrl, filterApiToken: "test-filter-token" }, "filter"),
    true
  );
  assert.strictEqual(
    isKdocsSyncConfigured({
      documentUrl: testDocumentUrl,
      customerServiceNameWebhookUrl: testCustomerServiceNameWebhookUrl,
      customerServiceNameApiToken: "test-customer-service-name-token"
    }, "customerServiceName"),
    true
  );
  assert.strictEqual(
    isKdocsSyncConfigured({
      documentUrl: testDocumentUrl,
      filterWebhookUrl: testFilterWebhookUrl,
      filterApiToken: "test-filter-token"
    }, "customerServiceName"),
    false
  );
  assert.throws(() => requireValidKdocsDocumentUrl("https://example.com/l/1"), /金山文档地址/);
  assert.throws(
    () => requireValidKdocsWebhookUrl(testWebhookUrl.replace("sync_task", "task")),
    /sync_task/
  );
}

function testLocalDetailMatrixAndMaxEndDate() {
  const localDataDetail = buildLocalDataDetail([
    buildDataRow("客服甲", 46236, "a"),
    buildDataRow("客服乙", 46237, "b"),
    buildDataRow("客服丙", 46237, "c")
  ]);
  assert.strictEqual(localDataDetail.dataRowCount, 3);
  assert.strictEqual(localDataDetail.columnCount, 24);
  assert.strictEqual(localDataDetail.lastRowNumber, 7);
  assert.strictEqual(localDataDetail.targetRangeAddress, "A4:X7");
  assert.strictEqual(localDataDetail.maxEndDateSerial, 46237);
  assert.strictEqual(localDataDetail.maxEndDateText, "2026-08-03");
  assert.strictEqual(localDataDetail.maxEndDateRowCount, 2);
  assert.deepStrictEqual(localDataDetail.endDateRowCounts, [
    { dateSerial: 46236, dateText: "2026-08-02", rowCount: 1 },
    { dateSerial: 46237, dateText: "2026-08-03", rowCount: 2 }
  ]);
  assert.strictEqual(localDataDetail.firstPersonName, "客服甲");
  assert.strictEqual(localDataDetail.lastPersonName, "客服丙");
}

function testLocalDetailRejectsNonEmptyRowWithoutCustomerName() {
  assert.throws(
    () => buildLocalDataDetail([buildDataRow("", 46237, "missing-name")]),
    /本地数据明细第5行缺少客服姓名/
  );
}

function testKdocsNumericPayloadUsesSpreadsheetPrecision() {
  assert.strictEqual(normalizeKdocsCellValue(21.240000000000002), 21.24);
  assert.strictEqual(normalizeKdocsCellValue(0.25263157894736843), 0.252631578947368);
  assert.strictEqual(normalizeKdocsCellValue(46223.3391319444), 46223.3391319444);
  assert.strictEqual(normalizeKdocsCellValue("21.240000000000002"), "21.240000000000002");
  assert.deepStrictEqual(
    normalizeKdocsDataDetailRows([["表头", 21.240000000000002], ["数据", 0.9835999999999999]]),
    [["表头", 21.24], ["数据", 0.9836]]
  );
}

async function testSingleAirScriptRequest() {
  let requestCount = 0;
  let capturedRequest = null;
  const result = await executeKdocsAirScriptSync({
    webhookUrl: testWebhookUrl,
    apiToken: "test-only-token",
    contextArguments: { operationType: "test_operation" },
    requestImplementation: async (url, options) => {
      requestCount += 1;
      capturedRequest = { url, options };
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            error: "",
            data: { result: JSON.stringify({ scriptVersion: KDOCS_SYNC_AIRSCRIPT_VERSION }) }
          });
        }
      };
    }
  });
  assert.strictEqual(requestCount, 1);
  assert.strictEqual(capturedRequest.options.headers["AirScript-Token"], "test-only-token");
  assert.strictEqual(
    JSON.parse(capturedRequest.options.body).Context.argv.operationType,
    "test_operation"
  );
  assert.strictEqual(result.scriptVersion, KDOCS_SYNC_AIRSCRIPT_VERSION);
}

async function testPivotEndDateDefaultsToLocalDataMaximum() {
  assert.strictEqual(isValidPivotFilterDate("2026-07-31"), true);
  assert.strictEqual(isValidPivotFilterDate("2026-02-30"), false);
  assert.throws(() => requireValidPivotFilterDate("2026/07/31"), /YYYY-MM-DD/);
  assert.strictEqual(
    await resolvePivotFilterDateInput({
      dateInput: "",
      workbookPath: "D:\\test-workbook.xlsx",
      readDataDetailWorkbookImplementation: async () => ({ maxEndDateText: "2026-08-03" })
    }),
    "2026-08-03"
  );
  await assert.rejects(
    () => resolvePivotFilterDateInput({
      dateInput: "最新",
      workbookPath: "D:\\test-workbook.xlsx",
      readDataDetailWorkbookImplementation: async () => {
        throw new Error("自定义输入不应读取默认日期");
      }
    }),
    /YYYY-MM-DD/
  );
  assert.strictEqual(
    await resolvePivotFilterDateInput({
      dateInput: " 2026-07-31 ",
      workbookPath: "D:\\test-workbook.xlsx",
      readDataDetailWorkbookImplementation: async () => {
        throw new Error("自定义输入不应读取默认日期");
      }
    }),
    "2026-07-31"
  );
  assert.strictEqual(resolveExcelDateSerial("2026-08-03"), 46237);

  let capturedDefaultArguments = null;
  let defaultWorkbookPath = null;
  const defaultResult = await updateKdocsPivotEndDateFilter({
    projectConfig: buildConfiguredProjectConfig(),
    filterDate: "   ",
    readDataDetailWorkbookImplementation: async (workbookPath) => {
      defaultWorkbookPath = workbookPath;
      return buildLocalDataDetail([
        buildDataRow("客服甲", 46236, "older"),
        buildDataRow("客服乙", 46237, "latest")
      ]);
    },
    requestImplementation: async (_url, options) => {
      capturedDefaultArguments = JSON.parse(options.body).Context.argv;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            error: "",
            data: {
              result: {
                scriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
                operationType: KDOCS_PIVOT_FILTER_OPERATION,
                filterDate: "2026-08-03",
                pivotTableCount: 2,
                successfulPivotTableCount: 2,
                failedPivotTables: [],
                saveCompleted: true
              }
            }
          });
        }
      };
    }
  });
  assert.strictEqual(defaultWorkbookPath, "D:\\test-workbook.xlsx");
  assert.deepStrictEqual(capturedDefaultArguments, {
    operationType: KDOCS_PIVOT_FILTER_OPERATION,
    requiredScriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
    pivotFilterDate: "2026-08-03",
    pivotFilterDateSerial: 46237
  });
  assert.strictEqual(defaultResult.filterDate, "2026-08-03");

  let capturedCustomArguments = null;
  const customResult = await updateKdocsPivotEndDateFilter({
    projectConfig: buildConfiguredProjectConfig(),
    filterDate: "2026-08-05",
    readDataDetailWorkbookImplementation: async () => {
      throw new Error("自定义输入不应读取默认日期");
    },
    requestImplementation: async (_url, options) => {
      capturedCustomArguments = JSON.parse(options.body).Context.argv;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            error: "",
            data: {
              result: {
                scriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
                operationType: KDOCS_PIVOT_FILTER_OPERATION,
                filterDate: "2026-08-05",
                pivotTableCount: 2,
                successfulPivotTableCount: 2,
                failedPivotTables: [],
                saveCompleted: true
              }
            }
          });
        }
      };
    }
  });
  assert.deepStrictEqual(capturedCustomArguments, {
    operationType: KDOCS_PIVOT_FILTER_OPERATION,
    requiredScriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
    pivotFilterDate: "2026-08-05",
    pivotFilterDateSerial: 46239
  });
  assert.strictEqual(customResult.filterDate, "2026-08-05");
  assert.strictEqual(customResult.successfulPivotTableCount, 2);
}

async function testTuiEmptyFilterDateUsesBusinessDefault() {
  const page = createKdocsPage();
  let receivedFilterDate = null;
  page.ctx = {
    services: {
      async runKdocsPivotEndDateFilterUpdate(filterDate) {
        receivedFilterDate = filterDate;
        return {
          filterDate: "2026-08-03",
          pivotTableCount: 2,
          successfulPivotTableCount: 2,
          failedPivotTableCount: 0,
          failedPivotTables: []
        };
      }
    }
  };
  const app = {
    async requestInput({ title }) {
      assert.match(title, /回车=数据最新日期/);
      return "";
    },
    requestRender() {}
  };

  await page.executeAction({ id: "filter" }, app);

  assert.strictEqual(receivedFilterDate, "");
  assert.strictEqual(page.state.message, "透视筛选已设为 2026-08-03。");
}

async function testCustomerServiceNameFilterUsesDedicatedWebhook() {
  let capturedUrl = null;
  let capturedArguments = null;
  const result = await reapplyKdocsCustomerServiceNameFilter({
    projectConfig: buildConfiguredProjectConfig(),
    requestImplementation: async (url, options) => {
      capturedUrl = url;
      capturedArguments = JSON.parse(options.body).Context.argv;
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            error: "",
            data: {
              result: {
                scriptVersion: KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION,
                operationType: KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
                pivotTableCount: 2,
                successfulPivotTableCount: 2,
                customerServiceNameFilterReappliedPivotTableCount: 2,
                customerServiceNameVisibleItemCounts: [
                  { pivotTableIndex: 1, visibleCustomerServiceNameCount: 1 },
                  { pivotTableIndex: 2, visibleCustomerServiceNameCount: 1 }
                ],
                failedPivotTables: [],
                saveCompleted: true
              }
            }
          });
        }
      };
    }
  });
  assert.strictEqual(capturedUrl, testCustomerServiceNameWebhookUrl);
  assert.notStrictEqual(capturedUrl, testFilterWebhookUrl);
  assert.deepStrictEqual(capturedArguments, {
    operationType: KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
    requiredScriptVersion: KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION
  });
  assert.strictEqual(result.successfulPivotTableCount, 2);
  assert.strictEqual(result.customerServiceNameFilterReappliedPivotTableCount, 2);
}

function columnNameToNumber(columnName) {
  return [...columnName].reduce((columnNumber, letter) => (
    columnNumber * 26 + letter.charCodeAt(0) - 64
  ), 0);
}

function columnNumberToName(columnNumber) {
  let remainingColumnNumber = columnNumber;
  let columnName = "";
  while (remainingColumnNumber > 0) {
    const letterOffset = (remainingColumnNumber - 1) % 26;
    columnName = String.fromCharCode(65 + letterOffset) + columnName;
    remainingColumnNumber = Math.floor((remainingColumnNumber - 1) / 26);
  }
  return columnName;
}

function parseA1RangeAddress(rangeAddress) {
  const normalizedAddress = String(rangeAddress).replace(/\$/g, "").toUpperCase();
  const matchedAddress = normalizedAddress.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!matchedAddress) throw new Error(`测试无法识别范围：${rangeAddress}`);
  return {
    startColumn: columnNameToNumber(matchedAddress[1]),
    startRow: Number(matchedAddress[2]),
    endColumn: columnNameToNumber(matchedAddress[3] || matchedAddress[1]),
    endRow: Number(matchedAddress[4] || matchedAddress[2])
  };
}

function formatAbsoluteRangeAddress(parsedRangeAddress) {
  return (
    `$${columnNumberToName(parsedRangeAddress.startColumn)}$${parsedRangeAddress.startRow}:` +
    `$${columnNumberToName(parsedRangeAddress.endColumn)}$${parsedRangeAddress.endRow}`
  );
}

class FakeRange {
  constructor(sheet, rangeAddress) {
    this.sheet = sheet;
    this.rangeAddress = String(rangeAddress).toUpperCase();
    this.parsedAddress = parseA1RangeAddress(rangeAddress);
  }

  get Value2() {
    this.sheet.events.push(`read:${this.sheet.name}:${this.rangeAddress}`);
    const values = [];
    for (let rowNumber = this.parsedAddress.startRow; rowNumber <= this.parsedAddress.endRow; rowNumber += 1) {
      const rowValues = [];
      for (
        let columnNumber = this.parsedAddress.startColumn;
        columnNumber <= this.parsedAddress.endColumn;
        columnNumber += 1
      ) {
        rowValues.push(this.sheet.readCell(rowNumber, columnNumber));
      }
      values.push(rowValues);
    }
    if (values.length === 1 && values[0].length === 1) return values[0][0];
    return values;
  }

  set Value2(value) {
    this.sheet.events.push(`write:${this.sheet.name}:${this.rangeAddress}`);
    if (this.parsedAddress.startRow === this.parsedAddress.endRow &&
        this.parsedAddress.startColumn === this.parsedAddress.endColumn) {
      this.sheet.writeCell(this.parsedAddress.startRow, this.parsedAddress.startColumn, value);
      return;
    }
    assert.ok(Array.isArray(value), `测试范围${this.rangeAddress}必须写入二维数组`);
    value.forEach((rowValues, rowOffset) => {
      rowValues.forEach((cellValue, columnOffset) => {
        this.sheet.writeCell(
          this.parsedAddress.startRow + rowOffset,
          this.parsedAddress.startColumn + columnOffset,
          cellValue
        );
      });
    });
  }

  set NumberFormat(numberFormat) {
    this.sheet.events.push(`format:${this.sheet.name}:${this.rangeAddress}:${numberFormat}`);
  }

  ClearContents() {
    this.sheet.events.push(`clear:${this.sheet.name}:${this.rangeAddress}`);
    for (let rowNumber = this.parsedAddress.startRow; rowNumber <= this.parsedAddress.endRow; rowNumber += 1) {
      for (
        let columnNumber = this.parsedAddress.startColumn;
        columnNumber <= this.parsedAddress.endColumn;
        columnNumber += 1
      ) {
        this.sheet.writeCell(rowNumber, columnNumber, "");
      }
    }
  }

  Address() {
    return formatAbsoluteRangeAddress(this.parsedAddress);
  }

  get Columns() {
    return { Count: this.parsedAddress.endColumn - this.parsedAddress.startColumn + 1 };
  }
}

class FakePivotItems {
  constructor(items) {
    this.items = items;
  }

  get Count() {
    return this.items.length;
  }

  Item(indexOrName) {
    if (Number.isInteger(indexOrName)) return this.items[indexOrName - 1];
    const matchedItem = this.items.find((item) => String(item.Name) === String(indexOrName));
    if (!matchedItem) throw new Error(`测试透视项不存在：${indexOrName}`);
    return matchedItem;
  }
}

function createVisibilityItem(name, visible, events, pivotTableIndex) {
  let currentVisibility = visible;
  return {
    Name: name,
    Value: name,
    get Visible() { return currentVisibility; },
    set Visible(nextVisibility) {
      currentVisibility = Boolean(nextVisibility);
      events.push(`customerVisible:${pivotTableIndex}:${name}:${currentVisibility}`);
    }
  };
}

class FakePivotTable {
  constructor({
    pivotTableIndex,
    dataSheet,
    events,
    sourceData,
    cachedDateTexts,
    customerItemStates = [
      { name: "客服甲", visible: true },
      { name: "客服乙", visible: false }
    ]
  }) {
    this.pivotTableIndex = pivotTableIndex;
    this.dataSheet = dataSheet;
    this.events = events;
    this.Name = `测试透视${pivotTableIndex}`;
    this.sourceData = sourceData;
    this.cachedDateTexts = [...cachedDateTexts];
    this.currentPage = "";
    this.customerItems = customerItemStates.map(({ name, visible }) => (
      createVisibilityItem(name, visible, events, pivotTableIndex)
    ));
  }

  get SourceData() {
    return this.sourceData;
  }

  set SourceData(nextSourceData) {
    this.sourceData = String(nextSourceData);
    this.events.push(`sourceData:${this.pivotTableIndex}:${this.sourceData}`);
  }

  readCurrentDateTexts() {
    const sourceRangeMatch = this.sourceData.match(/R(\d+)C(\d+):R(\d+)C(\d+)/i);
    if (!sourceRangeMatch) throw new Error(`测试无法识别透视源：${this.sourceData}`);
    const sourceRange = {
      startRow: Number(sourceRangeMatch[1]),
      startColumn: Number(sourceRangeMatch[2]),
      endRow: Number(sourceRangeMatch[3]),
      endColumn: Number(sourceRangeMatch[4])
    };
    const dateTexts = new Set();
    for (let rowNumber = sourceRange.startRow + 1; rowNumber <= sourceRange.endRow; rowNumber += 1) {
      const dateSerial = Number(this.dataSheet.readCell(rowNumber, sourceRange.startColumn + 1));
      if (Number.isInteger(dateSerial)) dateTexts.add(excelDateSerialToText(dateSerial));
    }
    return [...dateTexts];
  }

  RefreshTable() {
    this.events.push(`refresh:${this.pivotTableIndex}`);
    this.cachedDateTexts = this.readCurrentDateTexts();
  }

  PivotFields(fieldName) {
    if (fieldName === "客服姓名") {
      this.events.push(`customerItemsRead:${this.pivotTableIndex}`);
      return { PivotItems: () => new FakePivotItems(this.customerItems) };
    }
    if (fieldName !== "统计结束日") throw new Error(`测试透视字段不存在：${fieldName}`);
    const pivotTable = this;
    return {
      PivotItems() {
        return new FakePivotItems(
          pivotTable.cachedDateTexts.map((dateText) => ({ Name: dateText, Value: dateText }))
        );
      },
      ClearAllFilters() {
        pivotTable.events.push(`clearDateFilter:${pivotTable.pivotTableIndex}`);
      },
      get CurrentPage() { return pivotTable.currentPage; },
      set CurrentPage(dateItemName) {
        pivotTable.events.push(`currentPage:${pivotTable.pivotTableIndex}:${dateItemName}`);
        if (!pivotTable.cachedDateTexts.includes(String(dateItemName))) {
          throw new Error(`刷新前日期项不存在：${dateItemName}`);
        }
        pivotTable.currentPage = String(dateItemName);
      }
    };
  }
}

class FakePivotTables {
  constructor(pivotTables) {
    this.pivotTables = pivotTables;
  }

  get Count() {
    return this.pivotTables.length;
  }

  Item(pivotTableIndex) {
    return this.pivotTables[pivotTableIndex - 1];
  }
}

class FakeSheet {
  constructor(name, events) {
    this.name = name;
    this.events = events;
    this.cells = new Map();
    this.pivotTables = null;
  }

  get UsedRange() {
    if (!this.cells.size) return this.Range("A1:A1");
    let minimumRowNumber = Infinity;
    let minimumColumnNumber = Infinity;
    let maximumRowNumber = 1;
    let maximumColumnNumber = 1;
    this.cells.forEach((_value, cellKey) => {
      const [rowNumber, columnNumber] = cellKey.split(":").map(Number);
      minimumRowNumber = Math.min(minimumRowNumber, rowNumber);
      minimumColumnNumber = Math.min(minimumColumnNumber, columnNumber);
      maximumRowNumber = Math.max(maximumRowNumber, rowNumber);
      maximumColumnNumber = Math.max(maximumColumnNumber, columnNumber);
    });
    return this.Range(
      `${columnNumberToName(minimumColumnNumber)}${minimumRowNumber}:` +
      `${columnNumberToName(maximumColumnNumber)}${maximumRowNumber}`
    );
  }

  get ListObjects() {
    this.events.push(`listObjectsRead:${this.name}`);
    return { Count: 0 };
  }

  cellKey(rowNumber, columnNumber) {
    return `${rowNumber}:${columnNumber}`;
  }

  readCell(rowNumber, columnNumber) {
    return this.cells.get(this.cellKey(rowNumber, columnNumber)) ?? "";
  }

  writeCell(rowNumber, columnNumber, value) {
    this.cells.set(this.cellKey(rowNumber, columnNumber), value);
  }

  Range(rangeAddress) {
    return new FakeRange(this, rangeAddress);
  }

  PivotTables() {
    if (!this.pivotTables) throw new Error(`测试工作表${this.name}没有透视表`);
    return this.pivotTables;
  }
}

function seedMatrix(sheet, startRowNumber, startColumnNumber, matrix) {
  matrix.forEach((rowValues, rowOffset) => {
    rowValues.forEach((value, columnOffset) => {
      sheet.writeCell(startRowNumber + rowOffset, startColumnNumber + columnOffset, value);
    });
  });
}

function createAirScriptHarness({
  previousDataRows,
  includePivotSheet = false,
  pivotTableCount = 2,
  cachedDateTexts,
  customerItemStatesByPivotTable = [],
  afterSave
}) {
  const events = [];
  const dataSheet = new FakeSheet("数据明细", events);
  const pivotSheet = includePivotSheet ? new FakeSheet("透视结果", events) : null;
  const dateSheet = new FakeSheet("统计日期", events);
  dateSheet.writeCell(3, 1, cachedDateTexts[0] || "");
  const previousMatrix = [requiredHeaders, ...previousDataRows];
  seedMatrix(dataSheet, 1, 1, previousMatrix);
  const previousLastRowNumber = 1 + previousDataRows.length;
  const previousDataRangeAddress = `A1:X${previousLastRowNumber}`;
  const pivotTables = includePivotSheet
    ? Array.from({ length: pivotTableCount }, (_, pivotTableOffset) => (
      new FakePivotTable({
        pivotTableIndex: pivotTableOffset + 1,
        dataSheet,
        events,
        sourceData: buildKdocsPivotSourceData(previousDataRangeAddress),
        cachedDateTexts,
        customerItemStates: customerItemStatesByPivotTable[pivotTableOffset]
      })
    ))
    : [];
  if (pivotSheet) {
    pivotSheet.pivotTables = new FakePivotTables(pivotTables);
  }
  const sheets = new Map([["数据明细", dataSheet]]);
  if (pivotSheet) sheets.set("透视结果", pivotSheet);
  sheets.set("统计日期", dateSheet);
  let saveCount = 0;
  const Application = {
    Worksheets: {
      Item(sheetName) {
        const sheet = sheets.get(String(sheetName));
        if (!sheet) throw new Error(`测试工作表不存在：${sheetName}`);
        return sheet;
      }
    },
    ActiveWorkbook: {
      Save() {
        events.push("save");
        saveCount += 1;
        if (afterSave) afterSave({ saveCount, dataSheet, pivotSheet, dateSheet });
      }
    }
  };
  return { Application, dataSheet, pivotSheet, dateSheet, pivotTables, events };
}

function executeAirScriptHarness(harness, incomingDataRows, incomingHeaders = requiredHeaders) {
  const airScriptText = fs.readFileSync(airScriptTemplatePath, "utf8");
  const executeAirScript = new Function("Application", "Context", "console", airScriptText);
  return executeAirScript(
    harness.Application,
    {
      argv: {
        operationType: KDOCS_FULL_SYNC_OPERATION,
        requiredScriptVersion: KDOCS_SYNC_AIRSCRIPT_VERSION,
        dataDetailRows: [incomingHeaders, ...incomingDataRows],
        expectedDataRowCount: incomingDataRows.length,
        expectedColumnCount: 24
      }
    },
    { log() {} }
  );
}

function executeFilterAirScriptHarness(harness, filterDate) {
  const airScriptText = fs.readFileSync(airScriptFilterTemplatePath, "utf8");
  const executeAirScript = new Function("Application", "Context", "console", airScriptText);
  return executeAirScript(
    harness.Application,
    {
      argv: {
        operationType: KDOCS_PIVOT_FILTER_OPERATION,
        requiredScriptVersion: KDOCS_FILTER_AIRSCRIPT_VERSION,
        pivotFilterDate: filterDate,
        pivotFilterDateSerial: resolveExcelDateSerial(filterDate)
      }
    },
    { log() {} }
  );
}

function executeCustomerServiceNameAirScriptHarness(harness) {
  const airScriptText = fs.readFileSync(airScriptCustomerServiceNameTemplatePath, "utf8");
  const executeAirScript = new Function("Application", "Context", "console", airScriptText);
  return executeAirScript(
    harness.Application,
    {
      argv: {
        operationType: KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
        requiredScriptVersion: KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION
      }
    },
    { log() {} }
  );
}

function testFilterAirScriptSetsCurrentPageBeforeRefresh() {
  const harness = createAirScriptHarness({
    includePivotSheet: true,
    previousDataRows: [
      buildDataRow("客服甲", 46237, "a"),
      buildDataRow("客服乙", 46237, "b")
    ],
    cachedDateTexts: ["2026-08-03"]
  });
  const result = executeFilterAirScriptHarness(harness, "2026-08-03");
  assert.strictEqual(result.successfulPivotTableCount, 2);
  assert.strictEqual(result.failedPivotTables.length, 0);
  assert.strictEqual(result.saveCompleted, true);
  assert.strictEqual(harness.dateSheet.readCell(3, 1), "2026-08-03");
  assert.strictEqual(harness.pivotSheet.readCell(190, 1), "");
  assert.ok(harness.events.indexOf("currentPage:1:2026-08-03") < harness.events.indexOf("refresh:1"));
  assert.ok(harness.events.indexOf("currentPage:2:2026-08-03") < harness.events.indexOf("refresh:2"));
}

function testCustomerServiceNameAirScriptPreservesSelectionsAndRefreshes() {
  const harness = createAirScriptHarness({
    includePivotSheet: true,
    previousDataRows: [
      buildDataRow("客服甲", 46237, "a"),
      buildDataRow("客服乙", 46237, "b")
    ],
    pivotTableCount: 3,
    cachedDateTexts: ["2026-08-03"],
    customerItemStatesByPivotTable: [
      [
        { name: "客服甲", visible: true },
        { name: "客服乙", visible: false }
      ],
      [
        { name: "客服甲", visible: true },
        { name: "客服乙", visible: true }
      ],
      [{ name: "客服甲", visible: true }]
    ]
  });
  const result = executeCustomerServiceNameAirScriptHarness(harness);
  assert.strictEqual(result.successfulPivotTableCount, 3);
  assert.strictEqual(result.customerServiceNameFilterReappliedPivotTableCount, 3);
  assert.strictEqual(result.failedPivotTables.length, 0);
  assert.strictEqual(result.saveCompleted, true);
  assert.deepStrictEqual(
    harness.pivotTables.map((pivotTable) => pivotTable.customerItems.map((item) => item.Visible)),
    [[true, false], [true, true], [true]]
  );
  assert.deepStrictEqual(result.customerServiceNameVisibleItemCounts, [
    { pivotTableIndex: 1, visibleCustomerServiceNameCount: 1 },
    { pivotTableIndex: 2, visibleCustomerServiceNameCount: 2 },
    { pivotTableIndex: 3, visibleCustomerServiceNameCount: 1 }
  ]);
  const firstMutationIndex = harness.events.findIndex((event) => event.startsWith("customerVisible:"));
  assert.ok(harness.events.indexOf("customerItemsRead:1") < firstMutationIndex);
  assert.ok(harness.events.indexOf("customerItemsRead:2") < firstMutationIndex);
  assert.ok(harness.events.indexOf("customerItemsRead:3") < firstMutationIndex);
  assert.ok(harness.events.indexOf("customerVisible:1:客服乙:true") < harness.events.indexOf("customerVisible:1:客服乙:false"));
  assert.ok(harness.events.indexOf("customerVisible:1:客服乙:false") < harness.events.indexOf("refresh:1"));
  assert.ok(harness.events.indexOf("customerVisible:2:客服甲:false") < harness.events.indexOf("customerVisible:2:客服甲:true"));
  assert.ok(harness.events.indexOf("customerVisible:3:客服甲:true") >= 0);
  assert.strictEqual(harness.events.filter((event) => event === "save").length, 1);
  assert.ok(!harness.events.some((event) => /write:数据明细|sourceData:|currentPage:|clearDateFilter:/.test(event)));
}

function testAirScriptIgnoresVersionArgument() {
  const harness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"]
  });
  const airScriptText = fs.readFileSync(airScriptTemplatePath, "utf8");
  const executeAirScript = new Function("Application", "Context", "console", airScriptText);
  const result = executeAirScript(
    harness.Application,
    {
      argv: {
        operationType: KDOCS_FULL_SYNC_OPERATION,
        requiredScriptVersion: "legacy-version",
        dataDetailRows: [requiredHeaders, buildDataRow("客服甲", 46237, "new")],
        expectedDataRowCount: 1,
        expectedColumnCount: 24
      }
    },
    { log() {} }
  );
  assert.strictEqual(result.scriptVersion, KDOCS_SYNC_AIRSCRIPT_VERSION);
  assert.strictEqual("pivotTableCount" in result, false);
  assert.strictEqual(harness.pivotSheet, null);
  assert.strictEqual(harness.events.includes("write:数据明细:A1:X2"), true);
  assert.strictEqual(harness.events.includes("save"), true);
}

function testAirScriptOverwritesOnlineHeaderWithoutExtraHeaderGuard() {
  const ordinaryRangeHarness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"]
  });
  const ordinaryRangeResult = executeAirScriptHarness(ordinaryRangeHarness, [
    buildDataRow("客服甲", 46237, "new")
  ]);
  assert.strictEqual(ordinaryRangeResult.dataRangeAddress, "A1:X2");
  assert.strictEqual(
    ordinaryRangeHarness.events.some((event) => event.startsWith("listObjectsRead:")),
    false
  );

  const mismatchedHeaderHarness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"]
  });
  mismatchedHeaderHarness.dataSheet.writeCell(1, 1, "错误表头");
  const mismatchedHeaderResult = executeAirScriptHarness(mismatchedHeaderHarness, [
    buildDataRow("客服甲", 46237, "new")
  ]);
  assert.strictEqual(mismatchedHeaderResult.dataRangeAddress, "A1:X2");
  assert.strictEqual(mismatchedHeaderHarness.dataSheet.readCell(1, 1), "统计开始日");
  assert.strictEqual(mismatchedHeaderHarness.events.includes("write:数据明细:A1:X2"), true);
  assert.strictEqual(mismatchedHeaderHarness.events.includes("save"), true);

  const missingHeaderHarness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"]
  });
  missingHeaderHarness.dataSheet.cells = new Map([["1:1", ""]]);
  const missingHeaderResult = executeAirScriptHarness(missingHeaderHarness, [
    buildDataRow("客服甲", 46237, "new")
  ]);
  assert.strictEqual(missingHeaderResult.dataRangeAddress, "A1:X2");
  assert.strictEqual(missingHeaderHarness.dataSheet.readCell(1, 1), "统计开始日");

  const invalidIncomingHeaderHarness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"]
  });
  const invalidIncomingHeaders = [...requiredHeaders];
  invalidIncomingHeaders[0] = "错误请求表头";
  const invalidIncomingHeaderResult = executeAirScriptHarness(
    invalidIncomingHeaderHarness,
    [buildDataRow("客服甲", 46237, "new")],
    invalidIncomingHeaders
  );
  assert.strictEqual(invalidIncomingHeaderResult.readBackMatched, true);
  assert.strictEqual(invalidIncomingHeaderHarness.dataSheet.readCell(1, 1), "错误请求表头");
  assert.strictEqual(invalidIncomingHeaderHarness.events.includes("save"), true);
}

function testAirScriptUsesReadBackInsteadOfCustomerNameRowValidation() {
  const harness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"]
  });
  const result = executeAirScriptHarness(harness, [
    buildDataRow("", 46237, "missing-name")
  ]);
  assert.strictEqual(result.readBackDataRowCount, 1);
  assert.strictEqual(harness.dataSheet.readCell(2, 7), "");
}

function testAirScriptUsesReadBackInsteadOfSparseRowsValidation() {
  const harness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"],
    afterSave({ saveCount, dataSheet }) {
      if (saveCount !== 1) return;
      for (let columnNumber = 1; columnNumber <= 24; columnNumber += 1) {
        dataSheet.writeCell(3, columnNumber, "");
      }
    }
  });
  assert.throws(
    () => executeAirScriptHarness(harness, [
      buildDataRow("客服甲", 46237, "new-a"),
      buildDataRow("客服乙", 46237, "new-b")
    ]),
    /保存后在线“数据明细”整表回读与上传值不一致/
  );
}

function testAirScriptExpansionWritesDataOnly() {
  const harness = createAirScriptHarness({
    previousDataRows: [
      buildDataRow("客服甲", 46236, "old-a"),
      buildDataRow("客服乙", 46236, "old-b")
    ],
    cachedDateTexts: ["2026-08-02"]
  });
  const incomingDataRows = [
    buildDataRow("客服甲", 46236, "a"),
    buildDataRow("客服乙", 46237, "b"),
    buildDataRow("客服丙", 46237, "c"),
    buildDataRow("客服丁", 46237, "d")
  ];
  const result = executeAirScriptHarness(harness, incomingDataRows);

  assert.strictEqual(result.scriptVersion, KDOCS_SYNC_AIRSCRIPT_VERSION);
  assert.strictEqual(result.readBackMatched, true);
  assert.strictEqual(result.readBackDataRowCount, 4);
  assert.strictEqual(result.readBackLastRowNumber, 5);
  assert.strictEqual(result.dataRangeAddress, "A1:X5");
  assert.strictEqual(result.clearedTailRowCount, 0);
  assert.strictEqual(result.saveCompleted, true);
  assert.strictEqual("pivotTableCount" in result, false);
  assert.strictEqual(harness.pivotSheet, null);

  const writeIndex = harness.events.indexOf("write:数据明细:A1:X5");
  const dateFormatIndex = harness.events.indexOf("format:数据明细:A2:B5:yyyy-mm-dd");
  const timeFormatIndex = harness.events.indexOf("format:数据明细:R2:R5:yyyy-mm-dd hh:mm:ss");
  const firstSaveIndex = harness.events.indexOf("save");
  const readBackIndex = harness.events.indexOf("read:数据明细:A1:X5", firstSaveIndex + 1);
  assert.ok(writeIndex < dateFormatIndex);
  assert.ok(dateFormatIndex < timeFormatIndex);
  assert.ok(timeFormatIndex < firstSaveIndex);
  assert.ok(firstSaveIndex < readBackIndex);
  assert.strictEqual(
    harness.events.some((event) => /sourceData:|refresh:|currentPage:|clearDateFilter:/.test(event)),
    false
  );
  assert.strictEqual(harness.events.some((event) => event.startsWith("listObjectsRead:")), false);
}

function testAirScriptShrinkClearsOnlyOldTail() {
  const harness = createAirScriptHarness({
    previousDataRows: [
      buildDataRow("客服甲", 46235, "old-a"),
      buildDataRow("客服乙", 46235, "old-b"),
      buildDataRow("客服丙", 46236, "old-c"),
      buildDataRow("客服丁", 46236, "old-d"),
      buildDataRow("客服戊", 46236, "old-e")
    ],
    cachedDateTexts: ["2026-08-01", "2026-08-02"]
  });
  const result = executeAirScriptHarness(harness, [
    buildDataRow("客服甲", 46237, "new-a"),
    buildDataRow("客服乙", 46237, "new-b")
  ]);

  assert.strictEqual(result.readBackDataRowCount, 2);
  assert.strictEqual(result.readBackLastRowNumber, 3);
  assert.strictEqual(result.dataRangeAddress, "A1:X3");
  assert.strictEqual(result.clearedTailRowCount, 3);
  assert.ok(harness.events.includes("clear:数据明细:A4:X6"));
  assert.strictEqual(harness.dataSheet.readCell(4, 1), "");
  assert.strictEqual(harness.dataSheet.readCell(6, 24), "");
  assert.ok(
    harness.events.indexOf("clear:数据明细:A4:X6") < harness.events.indexOf("save")
  );
}

function testAirScriptNormalizesReadBackCellTypes() {
  const harness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"],
    afterSave({ saveCount, dataSheet }) {
      if (saveCount !== 1) return;
      dataSheet.writeCell(2, 1, "46237");
      dataSheet.writeCell(2, 2, "46237");
      dataSheet.writeCell(2, 18, "46237.5");
    }
  });
  const incomingDataRow = buildDataRow("客服甲", 46237, "new");
  incomingDataRow[10] = null;
  incomingDataRow[11] = undefined;
  const result = executeAirScriptHarness(harness, [incomingDataRow]);
  assert.strictEqual(result.readBackMatched, true);
  assert.strictEqual("pivotTableCount" in result, false);
  assert.strictEqual(harness.events.some((event) => event.startsWith("refresh:")), false);
}

function testAirScriptRejectsChangedReadBackValues() {
  const harness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"],
    afterSave({ saveCount, dataSheet }) {
      if (saveCount === 1) dataSheet.writeCell(2, 5, "保存后被篡改");
    }
  });
  assert.throws(
    () => executeAirScriptHarness(harness, [
      buildDataRow("客服甲", 46237, "new")
    ]),
    /保存后在线“数据明细”整表回读与上传值不一致/
  );
  assert.strictEqual(harness.events.includes("save"), true);
  assert.strictEqual(harness.events.some((event) => event.startsWith("refresh:")), false);
}

function testAirScriptPropagatesNativeSaveError() {
  const nativeSaveError = new Error("金山原生保存异常");
  const harness = createAirScriptHarness({
    previousDataRows: [buildDataRow("客服甲", 46236, "old")],
    cachedDateTexts: ["2026-08-02"],
    afterSave({ saveCount }) {
      if (saveCount === 1) throw nativeSaveError;
    }
  });
  assert.throws(
    () => executeAirScriptHarness(harness, [
      buildDataRow("客服甲", 46237, "new")
    ]),
    (error) => error === nativeSaveError
  );
  assert.strictEqual(harness.events.filter((event) => event === "save").length, 1);
  assert.strictEqual(harness.events.some((event) => event.startsWith("refresh:")), false);
}

async function testOldAirScriptIsRejectedBeforeSuccessAndFailureReceiptIsWritten() {
  const localDataDetail = buildLocalDataDetail([
    buildDataRow("客服甲", 46237, "a"),
    buildDataRow("客服乙", 46237, "b")
  ]);
  let capturedContextArguments = null;
  const receipts = [];
  await assert.rejects(
    () => syncDataDetailToKdocs({
      projectConfig: buildConfiguredProjectConfig(),
      readDataDetailWorkbookImplementation: async () => localDataDetail,
      calculateWorkbookSha256Implementation: async () => "test-sha256",
      executeAirScriptImplementation: async ({ contextArguments }) => {
        capturedContextArguments = contextArguments;
        return { operationType: "replace_data_detail", writtenDataRowCount: 2 };
      },
      receiptWriter: async (receipt) => receipts.push(receipt),
      nowImplementation: () => new Date("2026-08-07T04:00:00.000Z")
    }),
    /旧版本，已拒绝本次操作/
  );
  assert.strictEqual(capturedContextArguments.operationType, KDOCS_FULL_SYNC_OPERATION);
  assert.strictEqual(capturedContextArguments.requiredScriptVersion, KDOCS_SYNC_AIRSCRIPT_VERSION);
  assert.strictEqual("maxEndDateText" in capturedContextArguments, false);
  assert.strictEqual("maxEndDateSerial" in capturedContextArguments, false);
  assert.strictEqual(receipts.length, 1);
  assert.strictEqual(receipts[0].status, "failed");
  assert.strictEqual(receipts[0].remote.scriptVersion, "");
}

async function testVerifiedSyncWritesSuccessReceipt() {
  const previousDataRows = [buildDataRow("客服甲", 46236, "old")];
  const incomingDataRows = [
    buildDataRow("客服甲", 46237, "a"),
    buildDataRow("客服乙", 46237, "b")
  ];
  incomingDataRows[0][19] = 21.240000000000002;
  const localDataDetail = buildLocalDataDetail(incomingDataRows);
  const harness = createAirScriptHarness({
    previousDataRows,
    cachedDateTexts: ["2026-08-02"]
  });
  const remoteResult = executeAirScriptHarness(harness, incomingDataRows);
  const receipts = [];
  let capturedContextArguments = null;
  const syncResult = await syncDataDetailToKdocs({
    projectConfig: buildConfiguredProjectConfig(),
    readDataDetailWorkbookImplementation: async () => localDataDetail,
    calculateWorkbookSha256Implementation: async () => "test-sha256",
    executeAirScriptImplementation: async ({ contextArguments }) => {
      capturedContextArguments = contextArguments;
      return remoteResult;
    },
    receiptWriter: async (receipt) => receipts.push(receipt),
    nowImplementation: () => new Date("2026-08-07T04:30:00.000Z")
  });
  assert.strictEqual(syncResult.remoteDataRowCount, 2);
  assert.strictEqual("maxEndDateText" in syncResult, false);
  assert.strictEqual("pivotTableCount" in syncResult, false);
  assert.strictEqual(receipts.length, 1);
  assert.strictEqual(receipts[0].status, "success");
  assert.strictEqual(receipts[0].createdAt, "2026-08-07T04:30:00.000Z");
  assert.strictEqual("maxEndDateRowCount" in receipts[0].local, false);
  assert.strictEqual(receipts[0].remote.readBackDataRowCount, 2);
  assert.strictEqual(receipts[0].remote.readBackMatched, true);
  assert.strictEqual(capturedContextArguments.dataDetailRows[1][19], 21.24);
  assert.strictEqual("failedPivotTables" in receipts[0].remote, false);
  assert.strictEqual("webhookUrl" in receipts[0], false);
  assert.strictEqual("apiToken" in receipts[0], false);
}

function testReceiptStorePersistsSanitizedFacts() {
  const receiptPath = path.join(
    os.tmpdir(),
    `customer-performance-kdocs-sync-receipts-test-${process.pid}.json`
  );
  const previousReceiptPath = process.env.CUSTOMER_PERFORMANCE_KDOCS_SYNC_RECEIPT_PATH;
  process.env.CUSTOMER_PERFORMANCE_KDOCS_SYNC_RECEIPT_PATH = receiptPath;
  try {
    const marker = `test-${process.pid}-${Date.now()}`;
    appendKdocsSyncReceipt({
      marker,
      status: "success",
      apiToken: "must-not-persist",
      nested: {
        webhookUrl: testWebhookUrl,
        readBackDataRowCount: 2
      },
      errorMessage: `调用 ${testWebhookUrl} 失败`
    });
    const persistedReceipt = readKdocsSyncReceiptHistory().receipts[0];
    assert.strictEqual(persistedReceipt.marker, marker);
    assert.strictEqual("apiToken" in persistedReceipt, false);
    assert.strictEqual("webhookUrl" in persistedReceipt.nested, false);
    assert.strictEqual(persistedReceipt.nested.readBackDataRowCount, 2);
    assert.doesNotMatch(persistedReceipt.errorMessage, /example-file|example-script/);
  } finally {
    if (previousReceiptPath === undefined) {
      delete process.env.CUSTOMER_PERFORMANCE_KDOCS_SYNC_RECEIPT_PATH;
    } else {
      process.env.CUSTOMER_PERFORMANCE_KDOCS_SYNC_RECEIPT_PATH = previousReceiptPath;
    }
  }

  const sanitizedPayload = sanitizeReceiptValue({
    fileId: "hidden",
    script_id: "hidden",
    value: 1
  });
  assert.deepStrictEqual(sanitizedPayload, { value: 1 });
  assert.doesNotMatch(
    sanitizeKdocsDiagnosticText(`请求 ${testWebhookUrl}`),
    /example-file|example-script/
  );
}

function testFeatureInstructionsAndTemplate() {
  const outputLines = [];
  const terminal = {
    clear() {},
    writeLine(value = "") { outputLines.push(String(value)); },
    theme: {
      title: (value) => value,
      muted: (value) => value,
      heading: (value) => value
    }
  };
  const projectConfig = buildConfiguredProjectConfig();
  projectConfig.kdocsDataDetailSync.syncApiToken = "must-not-be-rendered";
  projectConfig.kdocsDataDetailSync.filterApiToken = "must-not-be-rendered-too";
  projectConfig.kdocsDataDetailSync.customerServiceNameApiToken = "must-not-be-rendered-three";
  renderKdocsSyncInstructions(terminal, projectConfig);
  const renderedText = outputLines.join("\n");
  assert.match(renderedText, /一键同步明细/);
  assert.doesNotMatch(renderedText, /一键同步明细并刷新透视/);
  assert.match(renderedText, /\[4\] 打开同步脚本/);
  assert.match(renderedText, /\[3\] 原样确认客服姓名勾选/);
  assert.match(renderedText, /\[6\] 打开客服姓名脚本/);
  assert.match(renderedText, /回车=数据最新日期/);
  assert.doesNotMatch(renderedText, /必填 YYYY-MM-DD/);
  assert.match(renderedText, /\[7\] 修改同步设置/);
  assert.match(renderedText, /\[H\] 状态与首次配置说明/);
  assert.match(renderedText, /\[0\] 返回/);
  assert.doesNotMatch(renderedText, /同步 webhook（菜单\[1\]）|不要求、不创建正规数据表|全量覆盖在线同名工作表|首次配置步骤|must-not-be-rendered/);
  outputLines.length = 0;
  renderKdocsSyncStatusInstructions(terminal, projectConfig);
  const statusText = outputLines.join("\n");
  assert.match(statusText, /同步 webhook（菜单\[1\]）/);
  assert.match(statusText, /筛选 webhook（菜单\[2\]）/);
  assert.match(statusText, /客服姓名 webhook（菜单\[3\]）/);
  assert.match(statusText, /不要求、不创建正规数据表/);
  assert.match(statusText, /全量覆盖在线同名工作表/);
  assert.match(statusText, /runtime/);
  assert.match(statusText, /首次配置步骤/);
  assert.doesNotMatch(statusText, /\[1\] 一键同步明细/);
  assert.doesNotMatch(statusText, /must-not-be-rendered/);
  const syncScriptText = fs.readFileSync(airScriptSyncTemplatePath, "utf8");
  assert.match(syncScriptText, new RegExp(`const scriptVersion = '${KDOCS_SYNC_AIRSCRIPT_VERSION}'`));
  assert.match(syncScriptText, /Application\.ActiveWorkbook\.Save\(\)/);
  assert.match(syncScriptText, /operationType: 'sync_data_detail'/);
  assert.doesNotMatch(syncScriptText, /RefreshTable\(\)|CurrentPage|PivotTables\(\)|透视结果|sourceData|maxEndDate/);

  const filterScriptText = fs.readFileSync(airScriptFilterTemplatePath, "utf8");
  assert.match(filterScriptText, new RegExp(`const scriptVersion = '${KDOCS_FILTER_AIRSCRIPT_VERSION}'`));
  assert.match(filterScriptText, /Application\.ActiveWorkbook\.Save\(\)/);
  assert.match(filterScriptText, /RefreshTable\(\)/);
  assert.match(filterScriptText, /CurrentPage/);
  assert.doesNotMatch(filterScriptText, /dateTextToExcelSerial|客服姓名|pivotTableReadBacks|requireReadBackRowsMatchIncoming/);
  const customerServiceNameScriptText = fs.readFileSync(airScriptCustomerServiceNameTemplatePath, "utf8");
  assert.match(customerServiceNameScriptText, /客服姓名/);
  assert.match(customerServiceNameScriptText, /PivotItems/);
  assert.match(customerServiceNameScriptText, /Application\.ActiveWorkbook\.Save\(\)/);
  assert.doesNotMatch(renderedText, /must-not-be-rendered/);
  assert.deepStrictEqual(parseKdocsDataRangeAddress("$A$1:$X$5"), {
    rangeAddress: "A1:X5",
    startColumnNumber: 1,
    startRowNumber: 1,
    endColumnNumber: 24,
    endRowNumber: 5
  });
  assert.strictEqual(buildKdocsPivotSourceData("A1:X5"), "=数据明细!R1C1:R5C24");
  assert.strictEqual(
    isExpectedKdocsPivotSourceData("='数据明细'!$A$1:$X$5", "A1:X5"),
    true
  );
  assert.doesNotThrow(() => requireCurrentKdocsAirScriptVersion({
    scriptVersion: KDOCS_SYNC_AIRSCRIPT_VERSION
  }, KDOCS_SYNC_AIRSCRIPT_VERSION));
  assert.throws(() => requireCurrentKdocsAirScriptVersion({}, KDOCS_SYNC_AIRSCRIPT_VERSION), /旧版无版本号/);
}

async function main() {
  testCurrentAirScriptVersionContract();
  testProjectConfigDefaults();
  testKdocsSettingValidation();
  testLocalDetailMatrixAndMaxEndDate();
  testLocalDetailRejectsNonEmptyRowWithoutCustomerName();
  testKdocsNumericPayloadUsesSpreadsheetPrecision();
  await testSingleAirScriptRequest();
  await testPivotEndDateDefaultsToLocalDataMaximum();
  await testTuiEmptyFilterDateUsesBusinessDefault();
  await testCustomerServiceNameFilterUsesDedicatedWebhook();
  testAirScriptIgnoresVersionArgument();
  testAirScriptOverwritesOnlineHeaderWithoutExtraHeaderGuard();
  testAirScriptUsesReadBackInsteadOfCustomerNameRowValidation();
  testAirScriptUsesReadBackInsteadOfSparseRowsValidation();
  testAirScriptExpansionWritesDataOnly();
  testFilterAirScriptSetsCurrentPageBeforeRefresh();
  testCustomerServiceNameAirScriptPreservesSelectionsAndRefreshes();
  testAirScriptShrinkClearsOnlyOldTail();
  testAirScriptNormalizesReadBackCellTypes();
  testAirScriptRejectsChangedReadBackValues();
  testAirScriptPropagatesNativeSaveError();
  await testOldAirScriptIsRejectedBeforeSuccessAndFailureReceiptIsWritten();
  await testVerifiedSyncWritesSuccessReceipt();
  testReceiptStorePersistsSanitizedFacts();
  testFeatureInstructionsAndTemplate();
  console.log("PASS 金山一键同步真实回读、仅同步明细、独立透视筛选脚本与回执持久化");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
