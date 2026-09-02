const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const XLSX = require("xlsx");
const {
  normalizeStoreMetricConfig,
  createPublicConfig
} = require("../src/config/storeMetricConfig");
const {
  requiredDataSourceHeaders,
  dataSourceSheetName
} = require("../src/summaryData/storeMetricDataSourceSchema");
const {
  buildDataSourceMatrix,
  readDataSourceWorkbook
} = require("../src/kdocsSync/dataSourceWorkbookReader");
const {
  requireValidKdocsDocumentUrl,
  requireValidKdocsWebhookUrl,
  isKdocsSyncConfigured
} = require("../src/kdocsSync/kdocsSyncSettings");
const { executeKdocsAirScriptSync } = require("../src/kdocsSync/kdocsAirScriptClient");
const {
  KDOCS_WRITE_SCRIPT_VERSION,
  syncDataSourceToKdocs
} = require("../src/kdocsSync/syncDataSourceToKdocs");
const {
  airScriptTemplatePath,
  renderKdocsSyncInstructions
} = require("../src/cli/cliKdocsSyncMenu");
const { renderDashboard } = require("../src/cli/cliDashboard");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "store-metric-kdocs-"));
const workbookPath = path.join(temporaryDirectory, "data-source.xlsx");
const emptyWorkbookPath = path.join(temporaryDirectory, "empty-data-source.xlsx");
const documentUrl = "https://www.kdocs.cn/l/example-document";
const webhookUrl = "https://www.kdocs.cn/api/v3/ide/file/file-id/script/script-id/sync_task";
const apiToken = "local-secret-token";

function createDataSourceRow(recordKey, metricValue = 123) {
  return [
    46235, "京东", "jd1", "京东1店", "京东-待处理预警单", metricValue,
    "项", "当前待处理快照", "店铺合规", "https://example.com", "待处理预警单", recordKey
  ];
}

function writeWorkbook(targetPath, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    dataSourceSheetName
  );
  XLSX.writeFile(workbook, targetPath);
}

writeWorkbook(workbookPath, [
  requiredDataSourceHeaders,
  createDataSourceRow("record-1", 123),
  createDataSourceRow("record-2", 456)
]);
writeWorkbook(emptyWorkbookPath, [requiredDataSourceHeaders]);

function buildWorksheetRow(values) {
  return new Map(values.map((value, columnOffset) => [columnOffset + 1, { value }]));
}

function buildProjectConfig(targetWorkbookPath = workbookPath) {
  return normalizeStoreMetricConfig({
    workbook: { path: targetWorkbookPath },
    kdocsDataSourceSync: { documentUrl, webhookUrl, apiToken }
  });
}

test("金山文档配置会规范化且公共配置不会暴露脚本令牌", () => {
  const normalizedConfig = buildProjectConfig();
  assert.deepEqual(normalizedConfig.kdocsDataSourceSync, {
    documentUrl,
    webhookUrl,
    apiToken
  });
  assert.equal(isKdocsSyncConfigured(normalizedConfig.kdocsDataSourceSync), true);
  assert.equal(isKdocsSyncConfigured({ documentUrl, webhookUrl, apiToken: "" }), false);
  assert.deepEqual(createPublicConfig(normalizedConfig).kdocsDataSourceSync, {
    documentUrl,
    webhookUrl: "",
    webhookConfigured: true,
    apiToken: "",
    apiTokenConfigured: true
  });
  assert.throws(() => requireValidKdocsDocumentUrl("https://example.com/l/1"), /金山文档地址/);
  assert.throws(() => requireValidKdocsWebhookUrl(webhookUrl.replace("sync_task", "task")), /sync_task/);
});

test("数据源读取使用12列表头，并拒绝空数据", async () => {
  const result = await readDataSourceWorkbook(workbookPath);
  assert.equal(result.dataRowCount, 2);
  assert.equal(result.columnCount, 12);
  assert.equal(result.dataSourceRows[1][11], "record-1");
  assert.equal(result.firstRecordKey, "record-1");
  assert.equal(result.lastRecordKey, "record-2");
  await assert.rejects(
    () => readDataSourceWorkbook(emptyWorkbookPath),
    /没有数据.*避免误清空/
  );
});

test("数据源中间行缺少记录键时拒绝同步", () => {
  const missingRecordKeyRow = createDataSourceRow("");
  const rows = new Map([
    [1, buildWorksheetRow(requiredDataSourceHeaders)],
    [2, buildWorksheetRow(createDataSourceRow("record-1"))],
    [3, buildWorksheetRow(missingRecordKeyRow)],
    [4, buildWorksheetRow(createDataSourceRow("record-3"))]
  ]);
  assert.throws(() => buildDataSourceMatrix(rows), /第3行缺少记录键/);
});

test("AirScript请求只发送一次并保留令牌在请求头，不进入正文", async () => {
  let capturedRequest = null;
  const result = await executeKdocsAirScriptSync({
    webhookUrl,
    apiToken,
    contextArguments: { operationType: "replace_data_source" },
    requestImplementation: async (requestUrl, requestOptions) => {
      capturedRequest = { requestUrl, requestOptions };
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            error: "",
            data: {
              result: JSON.stringify({
                operationType: "replace_data_source",
                writtenDataRowCount: 2,
                writtenColumnCount: 14
              })
            }
          });
        }
      };
    }
  });
  assert.equal(capturedRequest.requestUrl, webhookUrl);
  assert.equal(capturedRequest.requestOptions.headers["AirScript-Token"], apiToken);
  assert.doesNotMatch(capturedRequest.requestOptions.body, new RegExp(apiToken));
  assert.equal(result.writtenDataRowCount, 2);
});

test("远端错误回显脚本令牌时也会先隐藏", async () => {
  await assert.rejects(
    () => executeKdocsAirScriptSync({
      webhookUrl,
      apiToken,
      contextArguments: {},
      requestImplementation: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            error: `server echoed ${apiToken}`
          });
        }
      })
    }),
    (error) => {
      assert.match(error.message, /\[已隐藏\]/);
      assert.doesNotMatch(error.message, new RegExp(apiToken));
      return true;
    }
  );
});

test("HTTP非2xx时保留金山文档返回的安全错误摘要", async () => {
  await assert.rejects(
    () => executeKdocsAirScriptSync({
      webhookUrl,
      apiToken,
      contextArguments: {},
      requestImplementation: async () => ({
        ok: false,
        status: 500,
        async text() {
          return JSON.stringify({ error: `WPS API调用内部错误：网络访问失败（${apiToken}）` });
        }
      })
    }),
    (error) => {
      assert.match(error.message, /HTTP 500/);
      assert.match(error.message, /网络访问失败/);
      assert.doesNotMatch(error.message, new RegExp(apiToken));
      return true;
    }
  );
});

test("数据源同步只接受版本一致且逐格核验成功的在线镜像", async () => {
  let requestCount = 0;
  const result = await syncDataSourceToKdocs({
    projectConfig: buildProjectConfig(),
    requestImplementation: async (_requestUrl, requestOptions) => {
      requestCount += 1;
      const requestBody = JSON.parse(requestOptions.body);
      assert.equal(requestBody.Context.argv.dataSourceRows.length, 3);
      assert.equal(requestBody.Context.argv.expectedDataRowCount, 2);
      assert.equal(requestBody.Context.argv.expectedColumnCount, 12);
      assert.equal(requestBody.Context.argv.requiredScriptVersion, KDOCS_WRITE_SCRIPT_VERSION);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            data: {
              result: {
                scriptVersion: KDOCS_WRITE_SCRIPT_VERSION,
                operationType: "replace_data_source",
                verifiedDataRowCount: 2,
                verifiedColumnCount: 12,
                mismatchCellCount: 0,
                auditedRowCount: 3,
                auditedColumnCount: 12,
                saveCompleted: true
              }
            }
          });
        }
      };
    }
  });
  assert.equal(requestCount, 1);
  assert.equal(result.remoteDataRowCount, 2);
  assert.equal(result.mismatchCellCount, 0);

  await assert.rejects(
    () => syncDataSourceToKdocs({
      projectConfig: buildProjectConfig(),
      requestImplementation: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            data: {
              result: {
                scriptVersion: KDOCS_WRITE_SCRIPT_VERSION,
                operationType: "replace_data_source",
                verifiedDataRowCount: 1,
                verifiedColumnCount: 12,
                mismatchCellCount: 0,
                saveCompleted: true
              }
            }
          });
        }
      })
    }),
    /在线镜像数量不一致/
  );

  await assert.rejects(
    () => syncDataSourceToKdocs({
      projectConfig: buildProjectConfig(),
      requestImplementation: async () => ({
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "finished",
            data: {
              result: {
                scriptVersion: KDOCS_WRITE_SCRIPT_VERSION,
                operationType: "replace_data_source",
                verifiedDataRowCount: 2,
                verifiedColumnCount: 12,
                mismatchCellCount: 1,
                auditedRowCount: 3,
                auditedColumnCount: 12,
                saveCompleted: true
              }
            }
          });
        }
      })
    }),
    /不完全一致/
  );
});

test("首页和同步菜单说明包含入口但不显示脚本令牌", () => {
  const outputLines = [];
  const terminal = {
    clear() {},
    writeLine(value = "") { outputLines.push(String(value)); },
    theme: {
      title: (value) => value,
      muted: (value) => value,
      heading: (value) => value,
      success: (value) => value,
      error: (value) => value,
      status: (value) => value
    }
  };
  const projectConfig = buildProjectConfig();
  renderKdocsSyncInstructions(terminal, projectConfig);
  renderDashboard({
    terminal,
    config: projectConfig,
    state: { status: "idle" },
    taskHistory: { storeMetricRuns: [] }
  });
  const renderedText = outputLines.join("\n");
  assert.match(renderedText, /金山同步/);
  assert.match(renderedText, /\[A\] 金山文档同步/);
  assert.match(renderedText, /数据源/);
  assert.match(renderedText, /数据源脚本/);
  assert.doesNotMatch(renderedText, /透视/);
  assert.doesNotMatch(renderedText, new RegExp(apiToken));
});

test("写入AirScript整表清空后核验旧范围，不再用固定成功标记", () => {
  const scriptText = fs.readFileSync(airScriptTemplatePath, "utf8");
  const clearIndex = scriptText.indexOf("sheet.Cells.ClearContents()");
  const writeDataIndex = scriptText.indexOf(".Value2 = incomingRows");
  const dateFormatIndex = scriptText.indexOf(
    "sheet.Range(`A2:A${incomingRows.length}`).NumberFormat = 'yyyy-mm-dd'"
  );
  const auditIndex = scriptText.indexOf("const onlineRows = sheet.UsedRange.Value2");
  assert.match(scriptText, /scriptVersion = '2026-08-24\.platform-metric\.1'/);
  assert.match(scriptText, /Application\.Sheets\(sheetName\)/);
  assert.match(scriptText, /columnCount = 12/);
  assert.notEqual(clearIndex, -1);
  assert.notEqual(writeDataIndex, -1);
  assert.notEqual(dateFormatIndex, -1);
  assert.notEqual(auditIndex, -1);
  assert.ok(clearIndex < writeDataIndex);
  assert.ok(writeDataIndex < dateFormatIndex);
  assert.ok(dateFormatIndex < auditIndex);
  assert.match(scriptText, /Cells\.ClearContents\(\)/);
  assert.doesNotMatch(scriptText, /UsedRange\.RowEnd/);
  assert.match(scriptText, /Math\.max\(onlineRows\.length, incomingRows\.length\)/);
  assert.match(scriptText, /mismatchCellCount/);
  assert.doesNotMatch(scriptText, /const before|const after|auditRange/);
  assert.match(scriptText, /operationType: 'replace_data_source'/);
  assert.doesNotMatch(scriptText, /sourceCleared:\s*true/);
  assert.doesNotMatch(scriptText, /\.Clear\s*\(/);
  assert.doesNotMatch(scriptText, /\.ClearFormats\s*\(/);
  assert.doesNotMatch(scriptText, /\.Value\s*=/);
  assert.doesNotThrow(() => new Function(scriptText));
});

test("写入AirScript会清掉旧尾行和旧列；清空失效时不会假成功", () => {
  const scriptText = fs.readFileSync(airScriptTemplatePath, "utf8");
  const incomingRows = [
    requiredDataSourceHeaders,
    createDataSourceRow("record-1", 123),
    createDataSourceRow("record-2", 456)
  ];

  function executeWriteScript(clearWorks) {
    let saved = false;
    let cells = Array.from({ length: 5 }, () => Array(15).fill(""));
    cells[0] = [...requiredDataSourceHeaders, "旧列"];
    cells[3][13] = "old-tail-1";
    cells[4][14] = "old-tail-column";

    function columnNumber(letters) {
      return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
    }

    const sheet = {
      UsedRange: {
        get Value2() { return cells.map((row) => [...row]); }
      },
      Cells: {
        ClearContents() {
          if (clearWorks) cells = Array.from({ length: 5 }, () => Array(15).fill(""));
        }
      },
      Range(address) {
        const match = address.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        if (!match) throw new Error(`unexpected range ${address}`);
        const firstRow = Number(match[2]) - 1;
        const lastRow = Number(match[4]) - 1;
        const firstColumn = columnNumber(match[1]) - 1;
        const lastColumn = columnNumber(match[3]) - 1;
        return {
          get Value2() {
            return Array.from({ length: lastRow - firstRow + 1 }, (_value, rowOffset) =>
              Array.from({ length: lastColumn - firstColumn + 1 }, (_cell, columnOffset) =>
                cells[firstRow + rowOffset]?.[firstColumn + columnOffset] ?? ""
              )
            );
          },
          set Value2(rows) {
            rows.forEach((row, rowOffset) => row.forEach((value, columnOffset) => {
              cells[firstRow + rowOffset][firstColumn + columnOffset] = value;
            }));
          },
          set NumberFormat(_value) {}
        };
      }
    };
    const application = {
      Sheets(name) {
        assert.equal(name, "数据源");
        return sheet;
      },
      ActiveWorkbook: { Save() { saved = true; } }
    };
    const context = {
      argv: {
        operationType: "replace_data_source",
        requiredScriptVersion: KDOCS_WRITE_SCRIPT_VERSION,
        dataSourceRows: incomingRows,
        expectedDataRowCount: 2,
        expectedColumnCount: 12
      }
    };
    const result = new Function("Application", "Context", scriptText)(application, context);
    return { cells, result, saved };
  }

  const successful = executeWriteScript(true);
  assert.equal(successful.result.verifiedDataRowCount, 2);
  assert.equal(successful.result.mismatchCellCount, 0);
  assert.equal(successful.result.auditedRowCount, 5);
  assert.equal(successful.result.auditedColumnCount, 15);
  assert.equal(successful.cells[3][13], "");
  assert.equal(successful.cells[4][14], "");
  assert.equal(successful.saved, true);
  assert.throws(() => executeWriteScript(false), /在线数据与本地不一致/);
});
