(function attachXlsxExtractor(root) {
  // 解决不依赖联网库也能读取天猫退款导出xlsx的问题。
  const textDecoder = new TextDecoder('utf-8');
  const centralDirectorySignature = 0x02014b50;
  const localFileHeaderSignature = 0x04034b50;
  const endOfCentralDirectorySignature = 0x06054b50;

  function readUInt16(dataView, offset) {
    // 解决ZIP二进制字段读取必须统一小端格式的问题。
    return dataView.getUint16(offset, true);
  }

  function readUInt32(dataView, offset) {
    // 解决ZIP二进制字段读取必须统一小端格式的问题。
    return dataView.getUint32(offset, true);
  }

  function decodeBytes(bytes) {
    // 解决压缩包内XML和路径统一按UTF-8读取的问题。
    return textDecoder.decode(bytes);
  }

  function normalizeZipPath(zipPath) {
    // 解决Excel关系文件里相对路径和绝对路径混用的问题。
    const parts = String(zipPath).replace(/\\/g, '/').replace(/^\/+/, '').split('/');
    const normalizedParts = [];
    for (const part of parts) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        normalizedParts.pop();
        continue;
      }
      normalizedParts.push(part);
    }
    return normalizedParts.join('/');
  }

  function joinZipPath(basePath, targetPath) {
    // 解决workbook关系文件Target字段经常是相对路径的问题。
    if (String(targetPath).startsWith('/')) {
      return normalizeZipPath(targetPath);
    }
    const baseDirectory = normalizeZipPath(basePath).split('/').slice(0, -1).join('/');
    return normalizeZipPath(`${baseDirectory}/${targetPath}`);
  }

  function findEndOfCentralDirectory(dataView) {
    // 解决ZIP目录入口必须从文件尾部反向定位的问题。
    const minimumOffset = Math.max(0, dataView.byteLength - 65557);
    for (let offset = dataView.byteLength - 22; offset >= minimumOffset; offset -= 1) {
      if (readUInt32(dataView, offset) === endOfCentralDirectorySignature) {
        return offset;
      }
    }
    throw new Error('无法识别xlsx文件结构');
  }

  function readZipEntries(arrayBuffer) {
    // 解决从xlsx压缩包中央目录读取全部文件索引的问题。
    const dataView = new DataView(arrayBuffer);
    const endOffset = findEndOfCentralDirectory(dataView);
    const entryCount = readUInt16(dataView, endOffset + 10);
    let directoryOffset = readUInt32(dataView, endOffset + 16);
    const entries = new Map();

    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
      if (readUInt32(dataView, directoryOffset) !== centralDirectorySignature) {
        throw new Error('xlsx目录结构异常');
      }

      const compressionMethod = readUInt16(dataView, directoryOffset + 10);
      const compressedSize = readUInt32(dataView, directoryOffset + 20);
      const uncompressedSize = readUInt32(dataView, directoryOffset + 24);
      const fileNameLength = readUInt16(dataView, directoryOffset + 28);
      const extraFieldLength = readUInt16(dataView, directoryOffset + 30);
      const fileCommentLength = readUInt16(dataView, directoryOffset + 32);
      const localHeaderOffset = readUInt32(dataView, directoryOffset + 42);
      const fileNameStart = directoryOffset + 46;
      const fileName = normalizeZipPath(
        decodeBytes(new Uint8Array(arrayBuffer, fileNameStart, fileNameLength))
      );

      entries.set(fileName, {
        fileName,
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });

      directoryOffset = fileNameStart + fileNameLength + extraFieldLength + fileCommentLength;
    }

    return { arrayBuffer, dataView, entries };
  }

  function getCompressedEntryBytes(zipArchive, entry) {
    // 解决本地文件头长度不固定导致数据起点不能硬编码的问题。
    const { dataView, arrayBuffer } = zipArchive;
    if (readUInt32(dataView, entry.localHeaderOffset) !== localFileHeaderSignature) {
      throw new Error(`xlsx文件头异常：${entry.fileName}`);
    }

    const fileNameLength = readUInt16(dataView, entry.localHeaderOffset + 26);
    const extraFieldLength = readUInt16(dataView, entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + fileNameLength + extraFieldLength;
    return new Uint8Array(arrayBuffer, dataStart, entry.compressedSize);
  }

  async function inflateRawBytes(compressedBytes) {
    // 解决ZIP内deflate压缩数据需要在浏览器端解压的问题。
    if (typeof DecompressionStream === 'function') {
      const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    if (typeof require === 'function') {
      const zlib = require('node:zlib');
      const inflatedBuffer = zlib.inflateRawSync(Buffer.from(compressedBytes));
      return new Uint8Array(inflatedBuffer.buffer, inflatedBuffer.byteOffset, inflatedBuffer.byteLength);
    }

    throw new Error('当前浏览器不支持读取xlsx压缩内容');
  }

  async function readZipEntryBytes(zipArchive, entryPath) {
    // 解决按路径读取xlsx压缩包内文件内容的问题。
    const normalizedPath = normalizeZipPath(entryPath);
    const entry = zipArchive.entries.get(normalizedPath);
    if (!entry) {
      throw new Error(`xlsx缺少必要文件：${normalizedPath}`);
    }

    const compressedBytes = getCompressedEntryBytes(zipArchive, entry);
    if (entry.compressionMethod === 0) {
      return compressedBytes;
    }
    if (entry.compressionMethod === 8) {
      return inflateRawBytes(compressedBytes);
    }
    throw new Error(`xlsx压缩方式不支持：${entry.compressionMethod}`);
  }

  async function readZipEntryText(zipArchive, entryPath) {
    // 解决XML文件读取后统一转成字符串的问题。
    return decodeBytes(await readZipEntryBytes(zipArchive, entryPath));
  }

  function decodeXmlText(xmlText) {
    // 解决XML实体不还原会导致表头匹配失败的问题。
    return String(xmlText)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hexText) => String.fromCodePoint(parseInt(hexText, 16)))
      .replace(/&#(\d+);/g, (_, numberText) => String.fromCodePoint(parseInt(numberText, 10)));
  }

  function parseAttributes(attributeText) {
    // 解决XML节点属性读取需要兼容命名空间字段的问题。
    const attributes = {};
    const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const match of attributeText.matchAll(attributePattern)) {
      attributes[match[1]] = decodeXmlText(match[2] ?? match[3] ?? '');
    }
    return attributes;
  }

  function getColumnIndexFromCellReference(cellReference) {
    // 解决A1单元格地址需要换算成数字列索引的问题。
    const columnLetters = String(cellReference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase();
    if (!columnLetters) {
      return null;
    }

    let columnIndex = 0;
    for (const letter of columnLetters) {
      columnIndex = columnIndex * 26 + letter.charCodeAt(0) - 64;
    }
    return columnIndex - 1;
  }

  function extractTextNodes(xmlBlock) {
    // 解决富文本单元格可能拆成多个t节点的问题。
    const textValues = [];
    const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    for (const match of xmlBlock.matchAll(textPattern)) {
      textValues.push(decodeXmlText(match[1]));
    }
    return textValues.join('');
  }

  function parseSharedStrings(sharedStringsXml) {
    // 解决Excel把大量文本放到sharedStrings.xml里复用的问题。
    if (!sharedStringsXml) {
      return [];
    }

    const sharedStrings = [];
    const sharedStringPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    for (const match of sharedStringsXml.matchAll(sharedStringPattern)) {
      sharedStrings.push(extractTextNodes(match[1]));
    }
    return sharedStrings;
  }

  function extractCellValue(cellAttributes, cellXml, sharedStrings) {
    // 解决不同类型单元格需要统一转成可匹配文本的问题。
    if (cellAttributes.t === 'inlineStr') {
      return extractTextNodes(cellXml).trim();
    }

    const rawValue = decodeXmlText(cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || '').trim();
    if (!rawValue) {
      return '';
    }

    if (cellAttributes.t === 's') {
      return sharedStrings[Number(rawValue)] || '';
    }

    return rawValue;
  }

  function parseWorksheetRows(worksheetXml, sharedStrings) {
    // 解决从工作表XML按行收集单元格文本的问题。
    const rows = [];
    const rowPattern = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
    for (const rowMatch of worksheetXml.matchAll(rowPattern)) {
      const rowAttributes = parseAttributes(rowMatch[1]);
      const rowNumber = Number(rowAttributes.r || rows.length + 1);
      const cells = new Map();
      const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;

      for (const cellMatch of rowMatch[2].matchAll(cellPattern)) {
        const cellAttributes = parseAttributes(cellMatch[1]);
        const columnIndex = getColumnIndexFromCellReference(cellAttributes.r);
        if (columnIndex === null) {
          continue;
        }
        cells.set(columnIndex, extractCellValue(cellAttributes, cellMatch[2], sharedStrings));
      }

      rows.push({ rowNumber, cells });
    }
    return rows;
  }

  function findHeaderLocation(rows, headerName) {
    // 解决表格导出位置变化时仍能按表头定位订单编号列的问题。
    for (const row of rows) {
      for (const [columnIndex, value] of row.cells.entries()) {
        if (String(value).trim() === headerName) {
          return { rowNumber: row.rowNumber, columnIndex };
        }
      }
    }
    throw new Error(`xlsx里没有找到表头：${headerName}`);
  }

  function collectColumnValuesAfterHeader(rows, headerLocation) {
    // 解决只读取表头下方数据而不误把表头当订单号的问题。
    const values = [];
    for (const row of rows) {
      if (row.rowNumber <= headerLocation.rowNumber) {
        continue;
      }
      const value = String(row.cells.get(headerLocation.columnIndex) || '').trim();
      if (/^\d{12,30}$/.test(value)) {
        values.push(value);
      }
    }
    return values;
  }

  function collectTmallRefundOrderPairs(rows) {
    // 解决天猫退款编号必须反查真实订单编号而不是输出全表订单的问题。
    const orderHeaderLocation = findHeaderLocation(rows, '订单编号');
    const refundHeaderLocation = findHeaderLocation(rows, '退款编号');
    const dataStartRowNumber = Math.max(orderHeaderLocation.rowNumber, refundHeaderLocation.rowNumber);
    const refundOrderPairs = [];

    for (const row of rows) {
      if (row.rowNumber <= dataStartRowNumber) {
        continue;
      }

      const orderNumber = String(row.cells.get(orderHeaderLocation.columnIndex) || '').trim();
      const refundNumber = String(row.cells.get(refundHeaderLocation.columnIndex) || '').trim();
      if (/^\d{12,30}$/.test(orderNumber) && /^\d{12,30}$/.test(refundNumber)) {
        refundOrderPairs.push({ refundNumber, orderNumber });
      }
    }

    return refundOrderPairs;
  }

  function buildRefundToOrderMap(refundOrderPairs) {
    // 解决同一个退款编号必须稳定指向唯一订单编号的问题。
    const refundToOrderMap = new Map();
    for (const pair of refundOrderPairs) {
      const existingOrderNumber = refundToOrderMap.get(pair.refundNumber);
      if (existingOrderNumber && existingOrderNumber !== pair.orderNumber) {
        throw new Error(`退款编号${pair.refundNumber}对应多个订单编号`);
      }
      refundToOrderMap.set(pair.refundNumber, pair.orderNumber);
    }
    return refundToOrderMap;
  }

  function normalizeIdentifierList(values) {
    // 解决外部传入的退款编号列表可能包含空值或重复值的问题。
    return deduplicateInOriginalOrder(
      values
        .map((value) => String(value || '').trim())
        .filter((value) => /^\d{12,30}$/.test(value))
    );
  }

  function deduplicateInOriginalOrder(values) {
    // 解决一个订单多次退款导致复制结果重复的问题。
    const seenValues = new Set();
    const uniqueValues = [];
    for (const value of values) {
      if (seenValues.has(value)) {
        continue;
      }
      seenValues.add(value);
      uniqueValues.push(value);
    }
    return uniqueValues;
  }

  function getFirstWorksheetPath(workbookXml, relationshipsXml) {
    // 解决工作表文件名不固定时需要从Excel关系文件定位的问题。
    const sheetAttributesText = workbookXml.match(/<sheet\b([^>]*)\/?>/)?.[1];
    if (!sheetAttributesText) {
      throw new Error('xlsx里没有找到工作表');
    }

    const sheetAttributes = parseAttributes(sheetAttributesText);
    const relationshipId = sheetAttributes['r:id'];
    if (!relationshipId) {
      return 'xl/worksheets/sheet1.xml';
    }

    const relationshipPattern = /<Relationship\b([^>]*)\/?>/g;
    for (const match of relationshipsXml.matchAll(relationshipPattern)) {
      const attributes = parseAttributes(match[1]);
      if (attributes.Id === relationshipId && attributes.Target) {
        return joinZipPath('xl/workbook.xml', attributes.Target);
      }
    }

    throw new Error('xlsx里没有找到工作表关系');
  }

  async function readTmallRefundWorkbook(arrayBuffer, sourceName = '') {
    // 解决天猫退款导出表读取后同时保留退款编号和订单编号的问题。
    const zipArchive = readZipEntries(arrayBuffer);
    const workbookXml = await readZipEntryText(zipArchive, 'xl/workbook.xml');
    const relationshipsXml = await readZipEntryText(zipArchive, 'xl/_rels/workbook.xml.rels');
    const sharedStringsXml = zipArchive.entries.has('xl/sharedStrings.xml')
      ? await readZipEntryText(zipArchive, 'xl/sharedStrings.xml')
      : '';
    const worksheetPath = getFirstWorksheetPath(workbookXml, relationshipsXml);
    const worksheetXml = await readZipEntryText(zipArchive, worksheetPath);
    const sharedStrings = parseSharedStrings(sharedStringsXml);
    const rows = parseWorksheetRows(worksheetXml, sharedStrings);
    return { sourceName, worksheetPath, rows };
  }

  async function extractTmallOrderNumbersFromXlsxArrayBuffer(arrayBuffer, sourceName = '') {
    // 解决从天猫退款导出xlsx里提取全量真实订单号的问题，仅保留给测试和排查使用。
    const workbookData = await readTmallRefundWorkbook(arrayBuffer, sourceName);
    const rows = workbookData.rows;
    const orderHeaderLocation = findHeaderLocation(rows, '订单编号');
    const matches = collectColumnValuesAfterHeader(rows, orderHeaderLocation);
    const uniqueIdentifiers = deduplicateInOriginalOrder(matches);

    return {
      resultName: '天猫订单号',
      sourceName,
      worksheetPath: workbookData.worksheetPath,
      matches,
      uniqueIdentifiers,
      duplicateCount: matches.length - uniqueIdentifiers.length
    };
  }

  async function matchTmallOrderNumbersByRefundNumbersFromXlsxArrayBuffer(arrayBuffer, refundNumbers, sourceName = '') {
    // 解决只输出左侧退款编号对应订单号的问题。
    const workbookData = await readTmallRefundWorkbook(arrayBuffer, sourceName);
    const refundToOrderMap = buildRefundToOrderMap(collectTmallRefundOrderPairs(workbookData.rows));
    const uniqueRefundNumbers = normalizeIdentifierList(refundNumbers);
    const matchedOrderNumbers = [];
    const matchedRefundNumbers = [];
    const matchedRows = [];
    const unmatchedRefundNumbers = [];

    for (const refundNumber of uniqueRefundNumbers) {
      const orderNumber = refundToOrderMap.get(refundNumber);
      if (!orderNumber) {
        unmatchedRefundNumbers.push(refundNumber);
        continue;
      }
      matchedRefundNumbers.push(refundNumber);
      matchedOrderNumbers.push(orderNumber);
      matchedRows.push({ refundNumber, orderNumber });
    }

    const uniqueIdentifiers = deduplicateInOriginalOrder(matchedOrderNumbers);
    return {
      resultName: '天猫订单号',
      sourceName,
      worksheetPath: workbookData.worksheetPath,
      refundNumbers: uniqueRefundNumbers,
      matchedRefundNumbers,
      matchedRows,
      unmatchedRefundNumbers,
      matches: matchedOrderNumbers,
      uniqueIdentifiers,
      displayLines: matchedRows.map((row) => `${row.refundNumber}\t${row.orderNumber}`),
      duplicateCount: matchedOrderNumbers.length - uniqueIdentifiers.length
    };
  }

  async function extractTmallOrderNumbersFromXlsxFile(file) {
    // 解决页面选择文件后仍可做全量订单号排查的问题。
    if (!file) {
      throw new Error('没有选择xlsx文件');
    }
    if (!/\.xlsx$/i.test(file.name)) {
      throw new Error('请选择xlsx文件');
    }
    return extractTmallOrderNumbersFromXlsxArrayBuffer(await file.arrayBuffer(), file.name);
  }

  async function matchTmallOrderNumbersByRefundNumbersFromXlsxFile(file, refundNumbers) {
    // 解决页面选择文件后按左侧退款编号匹配真实订单号的问题。
    if (!file) {
      throw new Error('没有选择xlsx文件');
    }
    if (!/\.xlsx$/i.test(file.name)) {
      throw new Error('请选择xlsx文件');
    }
    return matchTmallOrderNumbersByRefundNumbersFromXlsxArrayBuffer(
      await file.arrayBuffer(),
      refundNumbers,
      file.name
    );
  }

  const publicApi = {
    extractTmallOrderNumbersFromXlsxArrayBuffer,
    extractTmallOrderNumbersFromXlsxFile,
    matchTmallOrderNumbersByRefundNumbersFromXlsxArrayBuffer,
    matchTmallOrderNumbersByRefundNumbersFromXlsxFile
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }

  root.TmallXlsxOrderExtractor = publicApi;
})(typeof window !== 'undefined' ? window : globalThis);
