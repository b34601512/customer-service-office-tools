// 该文件用于把聚合结果写回报量表，并刷新公式单元格的缓存数值。
function writeAggregationToWorksheet(worksheetDocument, cellMap, sharedStrings, config, dateColumns, targetDates, aggregation) {
  // 该函数用于把日报量写进目标工作表，并刷新汇总公式缓存。
  const targetDateSet = new Set(targetDates);
  let writtenQuantity = 0;
  for (const productRow of config.productRows) {
    for (const date of targetDateSet) {
      const dateColumn = dateColumns.byDate.get(date);
      if (!dateColumn) continue;
      const shiftQuantity = aggregation.rowDateShiftQuantity.get(productRow.row)?.get(date) || { day: 0, night: 0 };
      setCellNumber(worksheetDocument, cellMap, buildCellRef(dateColumn.dayCol, productRow.row), shiftQuantity.day);
      setCellNumber(worksheetDocument, cellMap, buildCellRef(dateColumn.nightCol, productRow.row), shiftQuantity.night);
      writtenQuantity += shiftQuantity.day + shiftQuantity.night;
    }
  }

  const groups = discoverSummaryGroups(worksheetDocument, cellMap, sharedStrings, config);
  const productTotals = recalculateProductTotals(worksheetDocument, cellMap, config, dateColumns);
  const summaryTotals = recalculateSummaryRows(worksheetDocument, cellMap, groups, dateColumns);
  recalculateTopRows(worksheetDocument, cellMap, config, dateColumns, productTotals, summaryTotals);

  return {
    writtenQuantity,
    productTotalQuantity: productTotals.totalQuantity,
    productTotalAmount: productTotals.totalAmount,
    summaryGroupCount: groups.length,
  };
}

function recalculateProductTotals(worksheetDocument, cellMap, config, dateColumns) {
  // 该函数用于根据产品每日白班和夜班数值刷新A列数量和B列销售额缓存。
  let totalQuantity = 0;
  let totalAmount = 0;
  for (const productRow of config.productRows) {
    let rowQuantity = 0;
    for (const dateColumn of dateColumns.items) {
      rowQuantity += readNumberCell(cellMap, buildCellRef(dateColumn.dayCol, productRow.row));
      rowQuantity += readNumberCell(cellMap, buildCellRef(dateColumn.nightCol, productRow.row));
    }
    const rowAmount = rowQuantity * parsePrice(productRow.productName);
    setFormulaCachedNumber(worksheetDocument, cellMap, buildCellRef(config.template.productTotalColumn, productRow.row), rowQuantity);
    setFormulaCachedNumber(worksheetDocument, cellMap, buildCellRef(config.template.salesTotalColumn, productRow.row), rowAmount);
    totalQuantity += rowQuantity;
    totalAmount += rowAmount;
  }
  return { totalQuantity, totalAmount };
}

function discoverSummaryGroups(worksheetDocument, cellMap, sharedStrings, config) {
  // 该函数用于从模板结构识别每个“本店汇总”行对应哪些产品行。
  const productRows = config.productRows || [];
  const template = config.template || {};
  const sortedRows = [...productRows].sort((a, b) => a.row - b.row);
  const productRowSet = new Set(sortedRows.map((item) => item.row));
  const minRow = Math.min(...sortedRows.map((item) => item.row));
  const maxRow = Math.max(...sortedRows.map((item) => item.row));
  const operatorColumn = template.operatorColumn || 3;
  const summaryLabelColumn = template.summaryLabelColumn || 4;
  const groups = [];
  let currentGroup = null;
  for (let row = Math.max(1, minRow - 5); row <= maxRow; row += 1) {
    const managerText = String(readCellValue(cellMap, buildCellRef(operatorColumn, row), sharedStrings) || "");
    const summaryText = String(readCellValue(cellMap, buildCellRef(summaryLabelColumn, row), sharedStrings) || "");
    if (managerText.includes("运营") && isStoreSummaryText(summaryText)) {
      currentGroup = { summaryRow: row, productRows: [] };
      groups.push(currentGroup);
      continue;
    }
    if (productRowSet.has(row) && currentGroup) {
      currentGroup.productRows.push(row);
    }
  }
  return groups.filter((group) => group.productRows.length > 0);
}

function isStoreSummaryText(text) {
  // 该函数用于兼容“本店汇总”“本店制氧机汇总”“本店销量汇总”等手工表写法。
  const normalizedText = String(text || "");
  return normalizedText.includes("本店") && normalizedText.includes("汇总");
}

function recalculateSummaryRows(worksheetDocument, cellMap, groups, dateColumns) {
  // 该函数用于刷新每个店铺每天的“本店汇总”缓存，供顶部总数继续汇总。
  const summaryByDate = new Map();
  for (const group of groups) {
    for (const dateColumn of dateColumns.items) {
      let total = 0;
      for (const productRow of group.productRows) {
        total += readNumberCell(cellMap, buildCellRef(dateColumn.dayCol, productRow));
        total += readNumberCell(cellMap, buildCellRef(dateColumn.nightCol, productRow));
      }
      setFormulaCachedNumber(worksheetDocument, cellMap, buildCellRef(dateColumn.summaryCol || dateColumn.nightCol, group.summaryRow), total);
      increaseMapCount(summaryByDate, dateColumn.date, total);
    }
  }
  return summaryByDate;
}

function recalculateTopRows(worksheetDocument, cellMap, config, dateColumns, productTotals, summaryTotals) {
  // 该函数用于刷新顶部当月销量、月销售额和每天总报量缓存。
  setFormulaCachedNumber(worksheetDocument, cellMap, config.template.topQuantityCell, productTotals.totalQuantity);
  setFormulaCachedNumber(worksheetDocument, cellMap, config.template.topAmountCell, productTotals.totalAmount);
  for (const dateColumn of dateColumns.items) {
    const dailyTotal = summaryTotals.get(dateColumn.date) || 0;
    setFormulaCachedNumber(worksheetDocument, cellMap, buildCellRef(dateColumn.topDailyCol || dateColumn.dayCol, config.template.topDailyRow), dailyTotal);
  }
}
