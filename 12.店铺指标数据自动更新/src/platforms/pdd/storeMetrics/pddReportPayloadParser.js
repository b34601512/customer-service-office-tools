const { createStoreMetricRecord } = require("../../../metrics/storeMetricRecord");
const {
  formatDate,
  normalizeLooseDateText,
  shiftDateText
} = require("../../../shared/exportDateRange");

const PDD_SOURCE_PAGE_BY_TYPE = {
  customer: "拼多多-客服数据",
  afterSales: "拼多多-售后数据",
  overall: "拼多多-综合体验星级"
};

const PDD_PAGE_METRIC_DEFINITIONS = {
  customer: [
    { metricName: "3分钟人工回复率", unit: "%", windowDays: 1 },
    { metricName: "平均人工响应时长", unit: "分钟", windowDays: 1 },
    { metricName: "询单转化率", unit: "%", windowDays: 1 },
    { metricName: "客服销售额", unit: "元", windowDays: 1 }
  ],
  afterSales: [
    { metricName: "纠纷退款数", unit: "单", windowDays: 1 },
    { metricName: "纠纷退款率", unit: "%", windowDays: 1 },
    { metricName: "介入订单数", unit: "单", windowDays: 1 },
    {
      metricName: "平台介入率",
      sourceMetricNames: ["介入率"],
      unit: "%",
      windowDays: 1
    },
    { metricName: "品质退款率", unit: "%", windowDays: 1 },
    { metricName: "平均退款时长", unit: "小时", windowDays: 1 },
    {
      metricName: "平均退款时长优于同行同层比例",
      unit: "%",
      windowDays: 1,
      specialParser: "peerBetterPercentage"
    },
    { metricName: "成功退款订单数", unit: "单", windowDays: 1 },
    { metricName: "成功退款金额", unit: "元", windowDays: 1 },
    { metricName: "成功退款率", unit: "%", windowDays: 1 },
    { metricName: "退货退款自主完结时长", unit: "小时", windowDays: 1 },
    { metricName: "退款自主完结时长", unit: "小时", windowDays: 1 }
  ],
  overall: [
    {
      metricName: "店铺综合体验星级",
      unit: "星",
      windowDays: 1,
      specialParser: "appDisplayedStar"
    },
    {
      metricName: "店铺综合体验星级同行超越比例",
      unit: "%",
      windowDays: 1,
      specialParser: "peerSurpassPercentage"
    },
    { metricName: "领航员综合分行业排名", unit: "%", windowDays: 1 },
    { metricName: "近30天平台求助率", unit: "%", windowDays: 30 },
    { metricName: "近30天3分钟人工回复率", unit: "%", windowDays: 30 },
    { metricName: "近30天在途订单退款时长", unit: "小时", windowDays: 30 },
    {
      metricName: "近30天商家签收消费者退货退款订单后的平均退款时长",
      sourceMetricNames: ["近30天商家签收消费者退货订单后的平均退款时长"],
      unit: "小时",
      windowDays: 30
    },
    { metricName: "近90天用户评价得分排名", unit: "%", windowDays: 90 },
    {
      metricName: "近30天积极评价率",
      sourceMetricNames: ["近30天积极评论率"],
      unit: "%",
      windowDays: 30
    },
    {
      metricName: "近30天严重货损率",
      sourceMetricNames: ["近30天严重劣质率"],
      unit: "%",
      windowDays: 30
    },
    { metricName: "近30天成团-签收时效", unit: "天", windowDays: 30 },
    { metricName: "近30天物流综合违规处理率", unit: "%", windowDays: 30 },
    {
      metricName: "近30天店铺活跃跨度",
      sourceMetricNames: ["近30天店铺活跃度"],
      unit: "%",
      windowDays: 30
    }
  ]
};

const PDD_DERIVED_METRIC_DEFINITIONS = {
  "平均人工响应时长": {
    metricName: "平均人工响应时长（秒）",
    unit: "秒",
    multiplier: 60
  }
};

function normalizePddText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function getPddDefinitionMetricNames(definition) {
  return Array.from(new Set([
    definition?.metricName,
    ...(Array.isArray(definition?.sourceMetricNames) ? definition.sourceMetricNames : [])
  ].map(normalizePddText).filter(Boolean)));
}

function findPddSectionEndIndex(sectionText, sectionStartIndex, endMarkers) {
  const candidateIndexes = (Array.isArray(endMarkers) ? endMarkers : [])
    .map((marker) => String(marker || ""))
    .filter(Boolean)
    .map((marker) => sectionText.indexOf(marker, sectionStartIndex))
    .filter((index) => index > sectionStartIndex);
  return candidateIndexes.length ? Math.min(...candidateIndexes) : sectionText.length;
}

function findPddOverallSectionStart(pageText) {
  const text = String(pageText || "").replace(/\r\n?/g, "\n");
  const cardPattern = /店铺综合体验星级\s*统计时间[:：][\s\S]{0,100}?拼多多\s*App\s*显示\s*\d+(?:\.\d+)?\s*星?/i;
  const cardMatch = text.match(cardPattern);
  if (cardMatch && Number.isInteger(cardMatch.index)) return cardMatch.index;
  const appDisplayIndex = text.search(/拼多多\s*App\s*显示\s*\d+(?:\.\d+)?\s*星?/i);
  return appDisplayIndex >= 0 ? text.lastIndexOf("店铺综合体验星级", appDisplayIndex) : -1;
}

function extractPddMetricSectionText(pageType, pageText) {
  const text = String(pageText || "").replace(/\r\n?/g, "\n");
  let sectionStartIndex = -1;
  let sectionEndMarkers = [];
  if (pageType === "customer") {
    sectionStartIndex = text.lastIndexOf("客服服务数据");
    if (sectionStartIndex < 0) sectionStartIndex = text.lastIndexOf("客服数据");
  }
  if (pageType === "afterSales") {
    sectionStartIndex = text.lastIndexOf("整体情况");
    sectionEndMarkers = ["TOP退款商品", "如何提升售后服务质量"];
  }
  if (pageType === "overall") {
    sectionStartIndex = findPddOverallSectionStart(text);
    sectionEndMarkers = ["店铺星级应用"];
  }
  if (sectionStartIndex < 0) return "";
  const sectionEndIndex = findPddSectionEndIndex(text, sectionStartIndex, sectionEndMarkers);
  return text.slice(sectionStartIndex, sectionEndIndex).trim();
}

function resolvePddDataDate(pageText, fallbackDate = new Date()) {
  const text = normalizePddText(pageText);
  const statisticDateMatch = text.match(/统计时间\s*[:：]?\s*([^\s)）]+)/);
  const statisticDate = normalizeLooseDateText(statisticDateMatch?.[1]);
  if (statisticDate) return statisticDate;
  const anyDate = normalizeLooseDateText(text);
  if (anyDate) return anyDate;
  return formatDate(fallbackDate);
}

function parsePddNumericValue(lineText, expectedUnit) {
  const normalizedLine = normalizePddText(lineText).replace(/,/g, "");
  if (!normalizedLine || /^(?:--|-)(?:\s|$)/.test(normalizedLine)) return null;
  const matchedNumber = normalizedLine.match(/-?(?:\d+\.?\d*|\.\d+)/);
  if (!matchedNumber) return null;
  const rawValue = Number(matchedNumber[0]);
  if (!Number.isFinite(rawValue)) return null;
  // 只按当前指标单位判断百分比，不能被同一行的同行对比百分号干扰。
  const containsPercent = expectedUnit === "%";
  return {
    metricValue: containsPercent ? rawValue / 100 : rawValue,
    unit: expectedUnit,
    rawText: normalizedLine
  };
}

function parsePddSpecialMetricValue(pageText, definition) {
  const normalizedText = normalizePddText(pageText);
  if (definition?.specialParser === "appDisplayedStar") {
    const appStarMatch = normalizedText.match(/拼多多\s*App\s*显示\s*(\d+(?:\.\d+)?)\s*星?/i);
    return appStarMatch ? parsePddNumericValue(appStarMatch[0], definition.unit) : null;
  }
  if (definition?.specialParser === "peerSurpassPercentage") {
    const peerSurpassMatch = normalizedText.match(/(?:已\s*)?超越\s*(\d+(?:\.\d+)?)\s*%\s*同行/);
    return peerSurpassMatch ? parsePddNumericValue(peerSurpassMatch[0], definition.unit) : null;
  }
  if (definition?.specialParser === "peerBetterPercentage") {
    const peerBetterMatch = normalizedText.match(/优于\s*(\d+(?:\.\d+)?)\s*%\s*同行(?:\s*同层)?/i);
    return peerBetterMatch ? parsePddNumericValue(peerBetterMatch[0], definition.unit) : null;
  }
  return null;
}

function findNextPddMetricIndex(text, metricName, metricNames) {
  const remainingText = String(text || "");
  const nextMetricIndexes = (Array.isArray(metricNames) ? metricNames : [])
    .filter((candidateMetricName) => candidateMetricName && candidateMetricName !== metricName)
    .map((candidateMetricName) => remainingText.indexOf(candidateMetricName))
    .filter((index) => index >= 0);
  return nextMetricIndexes.length ? Math.min(...nextMetricIndexes) : -1;
}

function findPddMetricOccurrenceIndexes(lineText, metricName, metricNames = []) {
  const normalizedLine = normalizePddText(lineText);
  const occurrenceIndexes = [];
  let searchStartIndex = 0;
  while (searchStartIndex < normalizedLine.length) {
    const occurrenceIndex = normalizedLine.indexOf(metricName, searchStartIndex);
    if (occurrenceIndex < 0) break;
    const isPartOfLongerMetric = (Array.isArray(metricNames) ? metricNames : [])
      .filter((candidateMetricName) => candidateMetricName && candidateMetricName !== metricName)
      .some((candidateMetricName) => {
        const candidateStartIndex = normalizedLine.indexOf(candidateMetricName);
        return candidateMetricName.includes(metricName) &&
          candidateStartIndex >= 0 &&
          candidateStartIndex <= occurrenceIndex &&
          candidateStartIndex + candidateMetricName.length > occurrenceIndex;
      });
    if (!isPartOfLongerMetric) occurrenceIndexes.push(occurrenceIndex);
    searchStartIndex = occurrenceIndex + metricName.length;
  }
  return occurrenceIndexes;
}

function extractPddSameLineMetricText(lineText, metricName, metricNames, occurrenceIndex = 0) {
  const normalizedLine = normalizePddText(lineText);
  const metricStartIndex = findPddMetricOccurrenceIndexes(normalizedLine, metricName, metricNames)[occurrenceIndex];
  if (!Number.isInteger(metricStartIndex) || metricStartIndex < 0) return "";
  const remainingText = normalizedLine.slice(metricStartIndex + metricName.length).trim();
  const nextMetricIndex = findNextPddMetricIndex(remainingText, metricName, metricNames);
  return nextMetricIndex >= 0 ? remainingText.slice(0, nextMetricIndex).trim() : remainingText;
}

function findPddMetricValue(lines, metricName, expectedUnit, metricNames = [], sourceMetricNames = []) {
  const metricNamesToSearch = Array.from(new Set([
    metricName,
    ...(Array.isArray(sourceMetricNames) ? sourceMetricNames : [])
  ].map(normalizePddText).filter(Boolean)));
  const allMetricNames = Array.from(new Set([
    ...metricNamesToSearch,
    ...(Array.isArray(metricNames) ? metricNames : [])
  ]));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const currentLine = normalizePddText(lines[lineIndex]);
    for (const candidateMetricName of metricNamesToSearch) {
      const occurrenceIndexes = findPddMetricOccurrenceIndexes(currentLine, candidateMetricName, allMetricNames);
      for (let occurrenceIndex = 0; occurrenceIndex < occurrenceIndexes.length; occurrenceIndex += 1) {
        const sameLineValue = parsePddNumericValue(
          extractPddSameLineMetricText(currentLine, candidateMetricName, allMetricNames, occurrenceIndex),
          expectedUnit
        );
        if (sameLineValue) return sameLineValue;
        for (const nearbyLine of lines.slice(lineIndex + 1, lineIndex + 6)) {
          const normalizedNearbyLine = normalizePddText(nearbyLine);
          if (!normalizedNearbyLine) continue;
          if (allMetricNames
            .some((otherMetricName) => otherMetricName !== candidateMetricName && normalizedNearbyLine.includes(otherMetricName))) {
            break;
          }
          if (/^(?:--|-)(?:\s|$)/.test(normalizedNearbyLine)) break;
          const nearbyValue = parsePddNumericValue(nearbyLine, expectedUnit);
          if (nearbyValue) return nearbyValue;
        }
      }
    }
  }
  return null;
}

function resolvePddStatisticsRange(dataDate, windowDays) {
  const normalizedWindowDays = Math.max(1, Number(windowDays) || 1);
  return {
    statisticsStartDate: normalizedWindowDays === 1
      ? dataDate
      : shiftDateText(dataDate, -(normalizedWindowDays - 1)),
    statisticsEndDate: dataDate,
    originalStatisticsWindow: normalizedWindowDays === 1
      ? `页面统计日：${dataDate}`
      : `页面近${normalizedWindowDays}天：${shiftDateText(dataDate, -(normalizedWindowDays - 1))}至${dataDate}`
  };
}

function buildPddMetricRecord(store, pageType, definition, pageText, sourceUrl, collectedAt, fallbackDate, metricNames) {
  const lines = String(pageText || "").split(/\r?\n/).map(normalizePddText).filter(Boolean);
  const fallbackLines = normalizePddText(pageText).split(/\s+/).filter(Boolean);
  const parsedValue = parsePddSpecialMetricValue(pageText, definition) ||
    findPddMetricValue(
      lines,
      definition.metricName,
      definition.unit,
      metricNames,
      definition.sourceMetricNames
    ) ||
    findPddMetricValue(
      fallbackLines,
      definition.metricName,
      definition.unit,
      metricNames,
      definition.sourceMetricNames
    );
  if (!parsedValue) return null;
  const dataDate = resolvePddDataDate(pageText, fallbackDate);
  const statisticsRange = resolvePddStatisticsRange(dataDate, definition.windowDays);
  return createStoreMetricRecord({
    platform: "拼多多",
    storeKey: store.key,
    storeName: store.displayName,
    dataDate,
    statisticsStartDate: statisticsRange.statisticsStartDate,
    statisticsEndDate: statisticsRange.statisticsEndDate,
    metricName: definition.metricName,
    metricValue: parsedValue.metricValue,
    unit: definition.unit,
    originalStatisticsWindow: statisticsRange.originalStatisticsWindow,
    sourcePage: PDD_SOURCE_PAGE_BY_TYPE[pageType] || `拼多多-${pageType}`,
    sourceUrl,
    sourceOriginalMetricName: definition.metricName,
    collectedAt
  });
}

function buildPddPageMetricRecords({ store, pageType, pageText, sourceUrl, collectedAt, fallbackDate }) {
  const definitions = PDD_PAGE_METRIC_DEFINITIONS[pageType] || [];
  const metricPageText = extractPddMetricSectionText(pageType, pageText);
  if (!metricPageText) return { records: [], skipped: definitions.map((d) => d.metricName) };
  const metricNames = Array.from(new Set(definitions.flatMap(getPddDefinitionMetricNames)));
  const skipped = [];
  const records = definitions.flatMap((definition) => {
    const record = buildPddMetricRecord(
      store,
      pageType,
      definition,
      metricPageText,
      sourceUrl,
      collectedAt,
      fallbackDate,
      metricNames
    );
    if (!record) { skipped.push(definition.metricName); return []; }
    return [record];
  });
  const derivedRecords = records.flatMap((record) => {
    const derivedDefinition = PDD_DERIVED_METRIC_DEFINITIONS[record.sourceOriginalMetricName];
    if (!derivedDefinition) return [];
    return [createStoreMetricRecord({
      ...record,
      metricName: derivedDefinition.metricName,
      metricValue: record.metricValue * derivedDefinition.multiplier,
      unit: derivedDefinition.unit,
      sourceOriginalMetricName: record.sourceOriginalMetricName
    })];
  });
  return { records: [...records, ...derivedRecords], skipped };
}

function buildPddStoreMetricRecords({ store, pageSnapshots, collectedAt = new Date().toISOString(), fallbackDate = new Date() }) {
  const records = [];
  const skipped = [];
  const seenMetricKeys = new Set();
  for (const snapshot of Array.isArray(pageSnapshots) ? pageSnapshots : []) {
    const pageResult = buildPddPageMetricRecords({
      store,
      pageType: snapshot.pageType,
      pageText: snapshot.pageText,
      sourceUrl: snapshot.sourceUrl,
      collectedAt,
      fallbackDate
    });
    for (const record of pageResult.records) {
      if (seenMetricKeys.has(record.recordKey)) continue;
      seenMetricKeys.add(record.recordKey);
      records.push(record);
    }
    for (const skippedName of pageResult.skipped) {
      skipped.push(skippedName);
    }
  }
  if (!records.length) throw new Error("拼多多店铺指标页面没有读取到有效数值。");
  return { records, skipped };
}

module.exports = {
  PDD_SOURCE_PAGE_BY_TYPE,
  PDD_PAGE_METRIC_DEFINITIONS,
  PDD_DERIVED_METRIC_DEFINITIONS,
  normalizePddText,
  resolvePddDataDate,
  parsePddNumericValue,
  findPddMetricValue,
  findNextPddMetricIndex,
  findPddMetricOccurrenceIndexes,
  extractPddSameLineMetricText,
  resolvePddStatisticsRange,
  buildPddPageMetricRecords,
  buildPddStoreMetricRecords
};
