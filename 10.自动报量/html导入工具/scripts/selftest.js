// 该文件用于运行浏览器内置自检，验证导入结果和汇总公式是否保留。
async function runSelfTest() {
  // 该函数用于开发自检，正常客服打开页面不会触发。
  try {
    clearResult();
    const params = new URLSearchParams(window.location.search);
    const targetDate = params.get("date") || "2026-07-03";
    pageState.mode = params.get("mode") === "month" ? "month" : params.get("mode") === "monthToToday" ? "monthToToday" : "day";
    setSelectedDate(targetDate, pageState.mode);
    const config = readConfigForm();
    setProgress(5, "自检：加载本地测试文件");
    const workbookBuffer = await (await fetch("../2026年智能报量-v6.4.xlsx")).arrayBuffer();
    const csvBuffer = await (await fetch("../订单商品明细统计.csv")).arrayBuffer();
    setProgress(15, "自检：解压报量表");
    const zipEntries = await unzipXlsx(workbookBuffer, () => {});
    const workbookContext = parseWorkbookContext(zipEntries);
    const sheetName = `2026-${Number(targetDate.slice(5, 7))}`;
    const targetSheet = workbookContext.sheets.find((sheet) => sheet.name.trim() === sheetName);
    if (!targetSheet) throw new Error(`自检找不到工作表：${sheetName}`);
    const worksheetDocument = parseXmlFile(zipEntries, targetSheet.path);
    const sharedStrings = readSharedStrings(zipEntries);
    const cellMap = buildCellMap(worksheetDocument);
    const dateColumns = discoverDateColumns(cellMap, config, sharedStrings);
    const targetDates = resolveTargetDates(dateColumns, targetDate, pageState.mode);
    setProgress(35, "自检：解析CSV");
    const csvData = parseCsv(decodeCsvText(csvBuffer));
    validateRequiredColumns(csvData.headers, config);
    setProgress(55, "自检：汇总订单");
    const aggregation = await aggregateCsvRows(csvData.records, config, buildMappingIndex(config.productRows), new Set(targetDates), () => {});
    setProgress(75, "自检：写入工作表");
    const writeResult = writeAggregationToWorksheet(worksheetDocument, cellMap, sharedStrings, config, dateColumns, targetDates, aggregation);
    zipEntries.set(targetSheet.path, encodeXml(worksheetDocument));
    removeCalculationArtifacts(zipEntries);
    const outputBytes = await buildXlsxZip(zipEntries, () => {});
    const roundTripEntries = await unzipXlsx(outputBytes.buffer, () => {});
    const roundTripContext = parseWorkbookContext(roundTripEntries);
    const roundTripSheet = roundTripContext.sheets.find((sheet) => sheet.name.trim() === sheetName);
    const roundTripDocument = parseXmlFile(roundTripEntries, roundTripSheet.path);
    const roundTripCellMap = buildCellMap(roundTripDocument);
    const result = {
      targetDates,
      csvRows: csvData.records.length,
      validRows: aggregation.validRows,
      matchedRows: aggregation.matchedRows,
      unmatchedRows: aggregation.unmatchedRows,
      writtenQuantity: writeResult.writtenQuantity,
      topQuantity: readNumberCell(roundTripCellMap, config.template.topQuantityCell),
      topAmount: readNumberCell(roundTripCellMap, config.template.topAmountCell),
      firstDailyTotal: readNumberCell(roundTripCellMap, buildCellRef(dateColumns.items[0].topDailyCol || dateColumns.items[0].dayCol, config.template.topDailyRow)),
      formulaCount: getElementsByLocalName(roundTripDocument, "f").length,
      outputSize: outputBytes.length,
      duplicateWarnings: aggregation.duplicateHitExamples.slice(0, 5),
      unmatchedExamples: aggregation.unmatchedExamples.slice(0, 5),
      skipped: [...aggregation.skippedByReason.entries()].slice(0, 20),
    };
    appendDetailLog(`SELFTEST_RESULT ${JSON.stringify(result, null, 2)}`);
    setProgress(100, "自检完成");
  } catch (error) {
    appendDetailLog(`SELFTEST_ERROR ${error.message || String(error)}`);
    setProgress(100, "自检失败");
  }
}
