// 该文件用于把CSV订单按店铺、料号、日期和班次聚合。
function buildMappingIndex(productRows) {
  // 该函数用于建立店铺和料号到报量行的索引，计算时不需要反复扫描配置。
  const index = new Map();
  for (const productRow of productRows) {
    for (const store of productRow.stores) {
      for (const materialCode of productRow.materialCodes) {
        const key = buildMappingKey(store, materialCode);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(productRow);
      }
    }
  }
  return index;
}

async function aggregateCsvRows(records, config, mappingIndex, targetDateSet, onProgress) {
  // 该函数用于把CSV订单汇总成报量表需要的行、日期、班次数量。
  const result = {
    rowDateShiftQuantity: new Map(),
    totalRows: records.length,
    validRows: 0,
    matchedRows: 0,
    unmatchedRows: 0,
    filteredRows: 0,
    writtenQuantity: 0,
    skippedByReason: new Map(),
    unmatchedExamples: [],
    duplicateHitExamples: [],
  };
  const columns = config.sourceColumns;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (index % 1000 === 0) {
      onProgress(records.length === 0 ? 1 : index / records.length);
      await yieldToUi();
    }
    const filterReason = getFilterReason(record, config);
    if (filterReason) {
      result.filteredRows += 1;
      increaseMapCount(result.skippedByReason, filterReason, 1);
      continue;
    }
    const paymentTime = parsePaymentTime(record[columns.paymentTime]);
    if (!paymentTime) {
      result.filteredRows += 1;
      increaseMapCount(result.skippedByReason, "付款时间为空或格式错误", 1);
      continue;
    }
    const dateAndShift = resolveDateAndShift(paymentTime, config);
    if (!targetDateSet.has(dateAndShift.date)) {
      increaseMapCount(result.skippedByReason, "不在导入日期范围", 1);
      continue;
    }
    result.validRows += 1;
    const storeName = cleanCell(record[columns.storeName]);
    const materialCode = cleanCell(record[columns.materialCode]);
    const quantity = parseNumber(record[columns.quantity]);
    const matches = mappingIndex.get(buildMappingKey(storeName, materialCode));
    if (!matches || matches.length === 0) {
      result.unmatchedRows += 1;
      rememberExample(result.unmatchedExamples, `${storeName} / ${materialCode}`, 20);
      continue;
    }
    const targetProductRow = chooseProductRow(matches, materialCode, config);
    if (matches.length > 1) {
      rememberExample(
        result.duplicateHitExamples,
        `${storeName} / ${materialCode} 命中多行，已写入第${targetProductRow.row}行：${matches.map((item) => `${item.row}${item.productName}`).join("；")}`,
        20,
      );
    }
    addAggregatedQuantity(result.rowDateShiftQuantity, targetProductRow.row, dateAndShift.date, dateAndShift.shift, quantity);
    result.matchedRows += 1;
    result.writtenQuantity += quantity;
  }
  onProgress(1);
  return result;
}

function getFilterReason(record, config) {
  // 该函数用于执行可配置过滤，把退款、取消、作废、赠品订单排除掉。
  const columns = config.sourceColumns;
  const tradeStatus = cleanCell(record[columns.tradeStatus]);
  if (config.filters.excludedTradeStatuses.includes(tradeStatus)) return `交易状态排除：${tradeStatus}`;
  const voidFlag = cleanCell(record[columns.voidFlag]);
  if (config.filters.excludedVoidValues.includes(voidFlag)) return `作废排除：${voidFlag}`;
  const refundFlag = cleanCell(record[columns.refundFlag]);
  if (config.filters.excludedRefundValues.includes(refundFlag)) return `退款排除：${refundFlag}`;
  const giftFlag = cleanCell(record[columns.giftFlag]);
  if (config.filters.excludedGiftValues.includes(giftFlag)) return `赠品排除：${giftFlag}`;
  return "";
}

function chooseProductRow(matches, materialCode, config) {
  // 该函数用于处理历史重复映射，优先按已验证料号产品名选择更可信的报量行。
  if (matches.length <= 1) return matches[0];
  const preferredName = config.materialCodePreferredProductName?.[materialCode];
  if (preferredName) {
    const preferred = matches.find((item) => normalizeProductText(item.productName).includes(normalizeProductText(preferredName)));
    if (preferred) return preferred;
  }
  return matches[0];
}

function normalizeProductText(text) {
  // 该函数用于比较产品名时去掉空白和括号价格，减少命名细节造成的误差。
  return cleanCell(text).replace(/（[^）]*）/g, "").replace(/\s+/g, "");
}

function addAggregatedQuantity(map, row, date, shift, quantity) {
  // 该函数用于累加同一报量行、同一天、同一班次的数量。
  if (!map.has(row)) map.set(row, new Map());
  const dateMap = map.get(row);
  if (!dateMap.has(date)) dateMap.set(date, { day: 0, night: 0 });
  dateMap.get(date)[shift] += quantity;
}
