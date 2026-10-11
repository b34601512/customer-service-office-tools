(function attachExtractor(root) {
  // 解决浏览器和Node测试共用同一套提取规则的问题。
  const extractorRules = {
    pinduoduo: {
      resultName: '拼多多订单号',
      pattern: /\b\d{6}-\d{15}\b/g,
      captureIndex: 0
    },
    tmall: {
      resultName: '天猫退款编号',
      pattern: /退款编号\s*[:：]\s*(\d{12,30})/g,
      captureIndex: 1
    }
  };

  function getExtractorRule(platformKey) {
    // 解决调用方传入未知平台时规则边界不清的问题。
    const extractorRule = extractorRules[platformKey];
    if (!extractorRule) {
      throw new Error(`未知店铺类型：${platformKey}`);
    }
    return extractorRule;
  }

  function collectMatches(sourceText, extractorRule) {
    // 解决不同正则捕获方式统一输出编号字符串的问题。
    const matches = [];
    for (const match of sourceText.matchAll(extractorRule.pattern)) {
      const identifier = match[extractorRule.captureIndex];
      if (identifier) {
        matches.push(identifier);
      }
    }
    return matches;
  }

  function deduplicateInOriginalOrder(matches) {
    // 解决重复编号影响后续复制处理的问题，同时保留原始出现顺序。
    const seenIdentifiers = new Set();
    const uniqueIdentifiers = [];
    for (const identifier of matches) {
      if (seenIdentifiers.has(identifier)) {
        continue;
      }
      seenIdentifiers.add(identifier);
      uniqueIdentifiers.push(identifier);
    }
    return uniqueIdentifiers;
  }

  function extractIdentifiers(sourceText, platformKey) {
    // 解决从杂乱文本中按店铺类型提取目标编号的问题。
    const extractorRule = getExtractorRule(platformKey);
    const safeSourceText = String(sourceText || '');
    const matches = collectMatches(safeSourceText, extractorRule);
    const uniqueIdentifiers = deduplicateInOriginalOrder(matches);
    return {
      resultName: extractorRule.resultName,
      matches,
      uniqueIdentifiers,
      duplicateCount: matches.length - uniqueIdentifiers.length
    };
  }

  const publicApi = {
    extractIdentifiers,
    getExtractorRule
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }

  root.OrderIdentifierExtractor = publicApi;
})(typeof window !== 'undefined' ? window : globalThis);
