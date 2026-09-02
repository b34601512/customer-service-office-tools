// 该文件用于解析和生成xlsx压缩包、工作簿关系、共享字符串和日期列。
function parseWorkbookContext(zipEntries) {
  // 该函数用于读取工作簿目录，找到每个月份工作表对应的XML文件。
  const workbookDocument = parseXmlFile(zipEntries, "xl/workbook.xml");
  const relationshipDocument = parseXmlFile(zipEntries, "xl/_rels/workbook.xml.rels");
  const relationships = new Map();
  for (const item of getElementsByLocalName(relationshipDocument, "Relationship")) {
    relationships.set(item.getAttribute("Id"), item.getAttribute("Target"));
  }
  const sheets = getElementsByLocalName(workbookDocument, "sheet").map((sheet) => {
    const relationshipId = sheet.getAttribute("r:id") || sheet.getAttributeNS(RELATIONSHIP_XML_NS, "id");
    const target = relationships.get(relationshipId);
    return {
      name: sheet.getAttribute("name"),
      path: resolveZipPath("xl/workbook.xml", target),
    };
  });
  return { sheets };
}

function readSharedStrings(zipEntries) {
  // 该函数用于读取模板里的共享字符串，识别“本店汇总”和产品名时需要它。
  if (!zipEntries.has("xl/sharedStrings.xml")) return [];
  const document = parseXmlFile(zipEntries, "xl/sharedStrings.xml");
  return getElementsByLocalName(document, "si").map((item) => item.textContent || "");
}

function parseXmlFile(zipEntries, path) {
  // 该函数用于把xlsx内部XML文本解析成DOM对象，解析失败会立即报错。
  const bytes = zipEntries.get(path);
  if (!bytes) throw new Error(`报量表缺少内部文件：${path}`);
  const text = new TextDecoder("utf-8").decode(bytes);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new Error(`XML解析失败：${path}`);
  }
  return document;
}

function encodeXml(document) {
  // 该函数用于把修改后的工作表XML写回xlsx压缩包。
  return new TextEncoder().encode(new XMLSerializer().serializeToString(document));
}

function buildCellMap(worksheetDocument) {
  // 该函数用于建立单元格引用到XML节点的索引，后续读写速度更稳定。
  const cellMap = new Map();
  for (const cell of getElementsByLocalName(worksheetDocument, "c")) {
    const ref = cell.getAttribute("r");
    if (ref) cellMap.set(ref, cell);
  }
  return cellMap;
}

function discoverDateColumns(cellMap, config, sharedStrings) {
  // 该函数用于识别每个日期对应的白班列和夜班列，避免在代码里写死D/E/F/G。
  const items = [];
  const byDate = new Map();
  const template = config.template || {};
  const dateRow = template.dateRow;
  const firstCol = template.firstDataColumn;
  const dateGroupWidth = Number(template.dateGroupWidth || 0);
  if (dateGroupWidth > 0) {
    for (let col = firstCol; col <= 200; col += dateGroupWidth) {
      const value = readCellValue(cellMap, buildCellRef(col, dateRow), sharedStrings);
      const serial = Number(value);
      if (!Number.isFinite(serial) || serial <= 0) continue;
      const date = excelSerialToDate(serial);
      const item = {
        date,
        dayCol: col + Number(template.dayColumnOffset || 0),
        nightCol: col + Number(template.nightColumnOffset || 1),
        summaryCol: col + Number(template.summaryColumnOffset ?? template.nightColumnOffset ?? 1),
        topDailyCol: col + Number(template.topDailyColumnOffset || 0),
      };
      items.push(item);
      byDate.set(date, item);
    }
    return { items, byDate };
  }
  for (let col = firstCol; col <= 200; col += 1) {
    const value = readCellValue(cellMap, buildCellRef(col, dateRow), sharedStrings);
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial <= 0) continue;
    const date = excelSerialToDate(serial);
    if (!byDate.has(date)) byDate.set(date, {});
    const current = byDate.get(date);
    if (!current.dayCol) {
      current.dayCol = col;
    } else if (!current.nightCol) {
      current.nightCol = col;
      current.summaryCol = current.nightCol;
      current.topDailyCol = current.dayCol;
      items.push({ date, dayCol: current.dayCol, nightCol: current.nightCol, summaryCol: current.summaryCol, topDailyCol: current.topDailyCol });
    }
  }
  const completeByDate = new Map(items.map((item) => [item.date, item]));
  return { items, byDate: completeByDate };
}

function resolveTargetDates(dateColumns, targetDate, mode) {
  // 该函数用于根据页面模式决定只写一天、本月到当天或开发自检整月。
  if (mode === "day") return dateColumns.byDate.has(targetDate) ? [targetDate] : [];
  const monthText = targetDate.slice(0, 7);
  if (mode === "monthToToday") {
    const monthStart = `${monthText}-01`;
    return dateColumns.items.filter((item) => item.date >= monthStart && item.date <= targetDate).map((item) => item.date);
  }
  return dateColumns.items.filter((item) => item.date.startsWith(monthText)).map((item) => item.date);
}

async function unzipXlsx(arrayBuffer, onProgress) {
  // 该函数用于在浏览器里解压xlsx，不依赖WPS或Excel进程。
  const source = new Uint8Array(arrayBuffer);
  const entries = readZipCentralDirectory(source);
  const output = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const compressed = source.slice(entry.dataStart, entry.dataStart + entry.compressedSize);
    let data;
    if (entry.method === 0) {
      data = compressed;
    } else if (entry.method === 8) {
      data = await inflateRaw(compressed);
    } else {
      throw new Error(`不支持的xlsx压缩方式：${entry.method}，文件：${entry.name}`);
    }
    output.set(entry.name, data);
    onProgress(entries.length === 0 ? 1 : (index + 1) / entries.length);
  }
  return output;
}

function readZipCentralDirectory(bytes) {
  // 该函数用于读取zip中央目录，定位xlsx内部每个文件的位置。
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 66000); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("报量表不是有效的xlsx文件。");
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("xlsx中央目录损坏。");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder("utf-8").decode(nameBytes);
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, method, compressedSize, uncompressedSize, dataStart });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(compressedBytes) {
  // 该函数用于用浏览器原生解压能力处理xlsx里的deflate数据。
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持本地解压xlsx，请使用最新版Chrome或Edge打开。");
  }
  try {
    const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (error) {
    const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
}

async function buildXlsxZip(entries, onProgress) {
  // 该函数用于把修改后的xlsx重新打包，优先压缩以控制文件体积。
  if (typeof CompressionStream === "undefined") {
    return buildStoredZip(entries);
  }
  try {
    return await buildDeflatedZip(entries, onProgress);
  } catch (error) {
    return buildStoredZip(entries);
  }
}

async function buildDeflatedZip(entries, onProgress) {
  // 该函数用于使用浏览器原生deflate压缩xlsx，避免导出文件过大。
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const fileEntries = [...entries].filter(([name]) => !name.endsWith("/"));
  for (let index = 0; index < fileEntries.length; index += 1) {
    const [name, data] = fileEntries[index];
    const compressedData = await deflateRaw(data);
    if (name.endsWith("/")) continue;
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const localHeader = createZipLocalHeader(nameBytes, crc, compressedData.length, data.length, 8);
    fileParts.push(localHeader, compressedData);
    centralParts.push(createZipCentralHeader(nameBytes, crc, compressedData.length, data.length, offset, 8));
    offset += localHeader.length + compressedData.length;
    if (onProgress) onProgress((index + 1) / fileEntries.length);
    if (index % 20 === 0) await yieldToUi();
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const eocd = createZipEndRecord(centralParts.length, centralSize, centralOffset);
  return concatBytes([...fileParts, ...centralParts, eocd]);
}

function buildStoredZip(entries) {
  // 该函数用于在浏览器不支持压缩时兜底生成xlsx，确保功能仍可用。
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, data] of entries) {
    if (name.endsWith("/")) continue;
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(data);
    const localHeader = createZipLocalHeader(nameBytes, crc, data.length, data.length, 0);
    fileParts.push(localHeader, data);
    centralParts.push(createZipCentralHeader(nameBytes, crc, data.length, data.length, offset, 0));
    offset += localHeader.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const eocd = createZipEndRecord(centralParts.length, centralSize, centralOffset);
  return concatBytes([...fileParts, ...centralParts, eocd]);
}

async function deflateRaw(bytes) {
  // 该函数用于把zip条目压缩为raw deflate，符合xlsx内部zip格式。
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function createZipLocalHeader(nameBytes, crc, compressedSize, uncompressedSize, method) {
  // 该函数用于创建zip本地文件头，xlsx可以接受无压缩条目。
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, method, true);
  view.setUint32(10, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, compressedSize, true);
  view.setUint32(22, uncompressedSize, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);
  return header;
}

function createZipCentralHeader(nameBytes, crc, compressedSize, uncompressedSize, localOffset, method) {
  // 该函数用于创建zip中央目录记录，让Excel能找到每个内部文件。
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, method, true);
  view.setUint32(12, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, compressedSize, true);
  view.setUint32(24, uncompressedSize, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, localOffset, true);
  header.set(nameBytes, 46);
  return header;
}

function createZipEndRecord(entryCount, centralSize, centralOffset) {
  // 该函数用于创建zip结束记录，标记中央目录的位置和数量。
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return record;
}

function crc32(bytes) {
  // 该函数用于计算zip条目校验值，Excel会用它判断文件是否损坏。
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function resolveZipPath(sourcePath, targetPath) {
  // 该函数用于把workbook关系文件里的相对路径转换成zip内部路径。
  if (!targetPath) throw new Error("工作簿关系缺少目标路径。");
  if (targetPath.startsWith("/")) return normalizeZipPath(targetPath.slice(1));
  const baseParts = sourcePath.split("/").slice(0, -1);
  return normalizeZipPath([...baseParts, ...targetPath.split("/")].join("/"));
}

function normalizeZipPath(path) {
  // 该函数用于清理zip路径里的点号和反斜杠。
  const parts = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function removeCalculationArtifacts(zipEntries) {
  // 该函数用于移除旧计算链，并要求WPS打开后重新计算保留下来的汇总公式。
  zipEntries.delete("xl/calcChain.xml");
  const workbookDocument = parseXmlFile(zipEntries, "xl/workbook.xml");
  let calcPr = getElementsByLocalName(workbookDocument, "calcPr")[0];
  if (!calcPr) {
    calcPr = workbookDocument.createElementNS(MAIN_XML_NS, "calcPr");
    workbookDocument.documentElement.appendChild(calcPr);
  }
  calcPr.setAttribute("calcMode", "auto");
  calcPr.setAttribute("fullCalcOnLoad", "1");
  calcPr.setAttribute("forceFullCalc", "1");
  zipEntries.set("xl/workbook.xml", encodeXml(workbookDocument));
}

function concatBytes(parts) {
  // 该函数用于把多个Uint8Array拼接成一个下载文件。
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
