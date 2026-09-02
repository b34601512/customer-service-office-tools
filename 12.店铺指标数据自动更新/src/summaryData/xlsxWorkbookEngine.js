const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const JSZip = require("jszip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");

const spreadsheetNamespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const officeRelationshipNamespace =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function listElements(parent, localName) {
  // 这个函数只按本地名称读取 XML 元素，兼容默认命名空间和带前缀命名空间。
  return Array.from(parent.getElementsByTagName("*")).filter(
    (element) => element.localName === localName
  );
}

function findFirstElement(parent, localName) {
  // 这个函数只取得第一个指定名称的 XML 元素。
  return listElements(parent, localName)[0] || null;
}

function parseXml(xmlText, fileLabel) {
  // 这个函数只把一份 xlsx 内部 XML 转换成可读写文档。
  const normalizedXmlText = String(xmlText || "")
    .replace(/^\uFEFF/, "")
    .replace(/^\s+(?=<\?xml)/, "");
  const parserMessages = [];
  const document = new DOMParser({
    onError(level, message) {
      if (level === "error" || level === "fatalError") {
        parserMessages.push(message);
      }
    }
  }).parseFromString(normalizedXmlText, "application/xml");
  if (!document?.documentElement || parserMessages.length) {
    throw new Error(`Excel 文件内部 XML 损坏：${fileLabel}。${parserMessages.join(" ")}`);
  }
  return document;
}

async function readArchiveXml(archive, archivePath) {
  // 这个函数只读取并解析压缩包内的一份 XML。
  const archiveFile = archive.file(archivePath);
  if (!archiveFile) {
    throw new Error(`Excel 文件缺少内部文件：${archivePath}`);
  }
  return parseXml(await archiveFile.async("string"), archivePath);
}

function writeArchiveXml(archive, archivePath, document) {
  // 这个函数只把修改后的 XML 写回内存压缩包。
  archive.file(archivePath, new XMLSerializer().serializeToString(document));
}

async function loadXlsxArchive(workbookPath) {
  // 这个函数只把一个 xlsx 文件载入内存，不启动 WPS/Excel。
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Excel 文件不存在：${workbookPath}`);
  }
  return JSZip.loadAsync(await fsPromises.readFile(workbookPath));
}

function resolveArchiveTarget(baseDirectory, target) {
  // 这个函数只把 xlsx 关系文件里的相对目标转换成压缩包路径。
  const normalizedTarget = String(target || "").replace(/^\/+/, "");
  if (normalizedTarget.startsWith("xl/")) {
    return path.posix.normalize(normalizedTarget);
  }
  return path.posix.normalize(path.posix.join(baseDirectory, normalizedTarget));
}

async function resolveWorksheetArchivePath(archive, sheetMode, sheetName) {
  // 这个函数只按“第一张”或指定名称定位工作表 XML。
  const workbookDocument = await readArchiveXml(archive, "xl/workbook.xml");
  const sheetElements = listElements(workbookDocument, "sheet");
  const targetSheet = sheetMode === "first_sheet"
    ? sheetElements[0]
    : sheetElements.find((sheet) => String(sheet.getAttribute("name") || "").trim() === String(sheetName || "").trim());
  if (!targetSheet) {
    const availableNames = sheetElements.map((sheet) => sheet.getAttribute("name")).filter(Boolean);
    throw new Error(`源文件没有子表「${sheetName}」。现有子表：${availableNames.join("、")}`);
  }

  const relationshipId =
    targetSheet.getAttributeNS(officeRelationshipNamespace, "id") ||
    targetSheet.getAttribute("r:id");
  const relationshipsDocument = await readArchiveXml(archive, "xl/_rels/workbook.xml.rels");
  const relationship = listElements(relationshipsDocument, "Relationship")
    .find((item) => item.getAttribute("Id") === relationshipId);
  if (!relationship) {
    throw new Error(`Excel 文件无法定位子表「${targetSheet.getAttribute("name")}」的内部关系。`);
  }
  return {
    sheetName: targetSheet.getAttribute("name"),
    worksheetPath: resolveArchiveTarget("xl", relationship.getAttribute("Target"))
  };
}

function readRichText(element) {
  // 这个函数只合并共享字符串或内联字符串里的全部文本片段。
  return listElements(element, "t").map((textElement) => textElement.textContent || "").join("");
}

async function loadSharedStringStore(archive) {
  // 这个函数只维护 xlsx 的共享字符串表，旧字符串原样保留，新字符串只追加一次。
  const archivePath = "xl/sharedStrings.xml";
  const archiveFile = archive.file(archivePath);
  const document = archiveFile
    ? parseXml(await archiveFile.async("string"), archivePath)
    : parseXml(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="${spreadsheetNamespace}" count="0" uniqueCount="0"/>`,
      archivePath
    );
  const values = listElements(document, "si").map(readRichText);
  const indexByValue = new Map(values.map((value, index) => [value, index]));

  function getIndex(value) {
    const text = String(value ?? "");
    if (indexByValue.has(text)) {
      return indexByValue.get(text);
    }
    const item = document.createElementNS(spreadsheetNamespace, "si");
    const textElement = document.createElementNS(spreadsheetNamespace, "t");
    if (/^\s|\s$/.test(text)) {
      textElement.setAttribute("xml:space", "preserve");
    }
    textElement.appendChild(document.createTextNode(text));
    item.appendChild(textElement);
    document.documentElement.appendChild(item);
    const index = values.length;
    values.push(text);
    indexByValue.set(text, index);
    return index;
  }

  function save(referenceCount) {
    document.documentElement.setAttribute("count", String(referenceCount));
    document.documentElement.setAttribute("uniqueCount", String(values.length));
    writeArchiveXml(archive, archivePath, document);
  }

  return {
    values,
    getIndex,
    save
  };
}

function columnLettersToIndex(columnLetters) {
  // 这个函数只把 A、B、AA 之类的列名转换成从 1 开始的列号。
  return String(columnLetters || "").toUpperCase().split("").reduce(
    (result, character) => result * 26 + character.charCodeAt(0) - 64,
    0
  );
}

function columnIndexToLetters(columnIndex) {
  // 这个函数只把从 1 开始的列号转换成 Excel 列名。
  let value = Number(columnIndex);
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function readCellValue(cellElement, sharedStrings) {
  // 这个函数只读取一个单元格的原始值，不猜测业务含义。
  const cellType = cellElement.getAttribute("t") || "";
  if (cellType === "inlineStr") {
    return readRichText(cellElement);
  }
  const valueElement = findFirstElement(cellElement, "v");
  if (!valueElement) {
    return null;
  }
  const valueText = valueElement.textContent || "";
  if (cellType === "s") {
    return sharedStrings[Number(valueText)] ?? "";
  }
  if (cellType === "str" || cellType === "e") {
    return valueText;
  }
  if (cellType === "b") {
    return valueText === "1";
  }
  const numericValue = Number(valueText);
  return Number.isFinite(numericValue) ? numericValue : valueText;
}

function readWorksheetRows(worksheetDocument, sharedStrings, numberFormats = []) {
  // 这个函数只把工作表转换成“行号 -> 列号 -> 单元格”的稀疏结构。
  const rows = new Map();
  for (const rowElement of listElements(worksheetDocument, "row")) {
    const rowNumber = Number(rowElement.getAttribute("r"));
    const cells = new Map();
    for (const cellElement of listElements(rowElement, "c")) {
      const reference = cellElement.getAttribute("r") || "";
      const columnLetters = reference.replace(/\d+/g, "");
      const styleIndex = Number(cellElement.getAttribute("s") || 0);
      const value = readCellValue(cellElement, sharedStrings);
      cells.set(columnLettersToIndex(columnLetters), {
        value,
        text: value == null ? "" : String(value),
        styleIndex,
        numberFormatCode: numberFormats[styleIndex] || ""
      });
    }
    rows.set(rowNumber, cells);
  }
  return rows;
}

async function readCellNumberFormats(archive) {
  // 这个函数只解析单元格样式对应的数字格式，供百分比和时长读取使用。
  const stylesDocument = await readArchiveXml(archive, "xl/styles.xml");
  const customFormats = new Map(
    listElements(stylesDocument, "numFmt").map((element) => [
      Number(element.getAttribute("numFmtId")),
      element.getAttribute("formatCode") || ""
    ])
  );
  const cellFormats = findFirstElement(stylesDocument, "cellXfs");
  if (!cellFormats) {
    return [];
  }
  const builtInFormats = new Map([
    [9, "0%"],
    [10, "0.00%"],
    [14, "mm-dd-yy"],
    [18, "h:mm AM/PM"],
    [20, "h:mm"],
    [21, "h:mm:ss"],
    [22, "m/d/yy h:mm"]
  ]);
  return Array.from(cellFormats.childNodes)
    .filter((node) => node.nodeType === 1 && node.localName === "xf")
    .map((element) => {
      const numberFormatId = Number(element.getAttribute("numFmtId") || 0);
      return customFormats.get(numberFormatId) || builtInFormats.get(numberFormatId) || "";
    });
}

function buildBackupDirectory(workbookPath, category) {
  // 这个函数只把写入前备份放到工作簿所在硬盘根目录的备份文件夹。
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
  return path.join(
    path.parse(workbookPath).root,
    "备份文件夹",
    "店铺指标数据自动更新",
    category,
    timestamp
  );
}

function isRetryableWorkbookCommitError(error) {
  return ["EPERM", "EBUSY", "EACCES"].includes(String(error?.code || "").toUpperCase());
}

async function renameWorkbookWithRetry(temporaryPath, workbookPath, options = {}) {
  // 该函数只处理Windows短暂占用；达到上限后原样交给上层保留待写文件。
  const maximumAttempts = Math.max(1, Number(options.maximumAttempts) || 12);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 1000);
  const renameFn = options.renameFn || fsPromises.rename;
  const waitFn = options.waitFn || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
    try {
      await renameFn(temporaryPath, workbookPath);
      return;
    } catch (error) {
      if (!isRetryableWorkbookCommitError(error) || attemptNumber === maximumAttempts) {
        throw error;
      }
      await waitFn(retryDelayMs);
    }
  }
}

async function preservePendingWorkbook(temporaryPath, workbookPath) {
  // 该函数只把无法提交的新表迁到备份区，确保原表和已采集结果都不丢失。
  const pendingDirectory = buildBackupDirectory(workbookPath, "待写入汇总表");
  await fsPromises.mkdir(pendingDirectory, { recursive: true });
  const pendingWorkbookPath = path.join(pendingDirectory, path.basename(temporaryPath));
  await fsPromises.rename(temporaryPath, pendingWorkbookPath);
  return pendingWorkbookPath;
}

async function moveInterruptedWriteFiles(workbookPath) {
  // 这个函数只迁移上次异常退出留下的同名临时写入文件。
  const workbookDirectory = path.dirname(workbookPath);
  const temporaryPrefix = `.${path.basename(workbookPath)}.write-`;
  const entries = await fsPromises.readdir(workbookDirectory, { withFileTypes: true });
  const interruptedFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.startsWith(temporaryPrefix)
  );
  if (!interruptedFiles.length) {
    return;
  }
  const backupDirectory = buildBackupDirectory(workbookPath, "中断写表临时文件");
  await fsPromises.mkdir(backupDirectory, { recursive: true });
  for (const entry of interruptedFiles) {
    await fsPromises.rename(
      path.join(workbookDirectory, entry.name),
      path.join(backupDirectory, entry.name)
    );
  }
}

async function saveXlsxArchiveAtomically(archive, workbookPath) {
  // 这个函数只执行“生成临时文件 -> 备份旧表 -> 原子替换”，中途失败不改旧表。
  await moveInterruptedWriteFiles(workbookPath);
  const workbookDirectory = path.dirname(workbookPath);
  const temporaryPath = path.join(
    workbookDirectory,
    `.${path.basename(workbookPath)}.write-${process.pid}-${Date.now()}.xlsx`
  );
  const workbookBuffer = await archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  await fsPromises.writeFile(temporaryPath, workbookBuffer, { flag: "wx" });

  const backupDirectory = buildBackupDirectory(workbookPath, "汇总表写入备份");
  await fsPromises.mkdir(backupDirectory, { recursive: true });
  await fsPromises.copyFile(workbookPath, path.join(backupDirectory, path.basename(workbookPath)));
  try {
    await renameWorkbookWithRetry(temporaryPath, workbookPath);
  } catch (error) {
    const pendingWorkbookPath = await preservePendingWorkbook(temporaryPath, workbookPath)
      .catch(() => temporaryPath);
    const workbookInUseError = new Error(
      `汇总表仍被WPS或Excel占用，已保留本次待写文件：${pendingWorkbookPath}。请保存并关闭汇总表后重试。`
    );
    workbookInUseError.code = error?.code || "WORKBOOK_COMMIT_FAILED";
    workbookInUseError.pendingWorkbookPath = pendingWorkbookPath;
    throw workbookInUseError;
  }
  return { backupDirectory };
}

module.exports = {
  spreadsheetNamespace,
  listElements,
  findFirstElement,
  readArchiveXml,
  writeArchiveXml,
  loadXlsxArchive,
  resolveArchiveTarget,
  resolveWorksheetArchivePath,
  loadSharedStringStore,
  readWorksheetRows,
  readCellNumberFormats,
  columnIndexToLetters,
  isRetryableWorkbookCommitError,
  renameWorkbookWithRetry,
  saveXlsxArchiveAtomically
};
