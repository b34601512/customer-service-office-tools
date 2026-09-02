// 该文件用于读写工作表单元格、解析单元格坐标和列号。
function setCellNumber(worksheetDocument, cellMap, ref, value) {
  // 该函数用于把目标单元格写成纯数字，并删除可能残留的公式节点。
  const cell = ensureCell(worksheetDocument, cellMap, ref);
  for (const child of [...cell.childNodes]) {
    if (child.localName === "f" || child.localName === "is" || child.localName === "v") {
      cell.removeChild(child);
    }
  }
  cell.removeAttribute("t");
  const valueNode = worksheetDocument.createElementNS(MAIN_XML_NS, "v");
  valueNode.textContent = formatRawNumber(value);
  cell.appendChild(valueNode);
}

function setFormulaCachedNumber(worksheetDocument, cellMap, ref, value) {
  // 该函数用于更新公式单元格的缓存值，保留公式本身，避免导出后汇总公式丢失。
  const cell = ensureCell(worksheetDocument, cellMap, ref);
  const formulaNode = [...cell.childNodes].find((child) => child.localName === "f");
  if (!formulaNode) {
    setCellNumber(worksheetDocument, cellMap, ref, value);
    return;
  }
  for (const child of [...cell.childNodes]) {
    if (child.localName === "is" || child.localName === "v") {
      cell.removeChild(child);
    }
  }
  cell.removeAttribute("t");
  const valueNode = worksheetDocument.createElementNS(MAIN_XML_NS, "v");
  valueNode.textContent = formatRawNumber(value);
  formulaNode.parentNode.insertBefore(valueNode, formulaNode.nextSibling);
}

function ensureCell(worksheetDocument, cellMap, ref) {
  // 该函数用于确保目标单元格存在，极少数空单元格也能被安全写入。
  if (cellMap.has(ref)) return cellMap.get(ref);
  const { rowNumber, colNumber } = parseCellRef(ref);
  const sheetData = getElementsByLocalName(worksheetDocument, "sheetData")[0];
  let rowNode = getElementsByLocalName(worksheetDocument, "row").find((row) => Number(row.getAttribute("r")) === rowNumber);
  if (!rowNode) {
    rowNode = worksheetDocument.createElementNS(MAIN_XML_NS, "row");
    rowNode.setAttribute("r", String(rowNumber));
    insertSorted(sheetData, rowNode, (node) => Number(node.getAttribute("r")), rowNumber);
  }
  const cell = worksheetDocument.createElementNS(MAIN_XML_NS, "c");
  cell.setAttribute("r", ref);
  insertSorted(rowNode, cell, (node) => parseCellRef(node.getAttribute("r")).colNumber, colNumber);
  cellMap.set(ref, cell);
  return cell;
}

function insertSorted(parent, newNode, readSortValue, newSortValue) {
  // 该函数用于按行号或列号插入节点，避免生成的XML顺序混乱。
  const children = [...parent.children];
  const next = children.find((child) => readSortValue(child) > newSortValue);
  parent.insertBefore(newNode, next || null);
}

function readCellValue(cellMap, ref, sharedStrings) {
  // 该函数用于读取单元格显示值，兼容共享字符串和普通数字。
  const cell = cellMap.get(ref);
  if (!cell) return "";
  const valueNode = [...cell.childNodes].find((node) => node.localName === "v");
  if (!valueNode) return "";
  const rawValue = valueNode.textContent || "";
  if (cell.getAttribute("t") === "s") {
    return sharedStrings[Number(rawValue)] || "";
  }
  return rawValue;
}

function readNumberCell(cellMap, ref) {
  // 该函数用于读取报量数字，空白和非数字都按0处理。
  const cell = cellMap.get(ref);
  if (!cell) return 0;
  const valueNode = [...cell.childNodes].find((node) => node.localName === "v");
  if (!valueNode) return 0;
  return parseNumber(valueNode.textContent || "0");
}

function parseCellRef(ref) {
  // 该函数用于拆分A1单元格引用，方便按行列写入。
  const match = String(ref).match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`非法单元格引用：${ref}`);
  return { colNumber: columnNameToNumber(match[1]), rowNumber: Number(match[2]) };
}

function buildCellRef(colNumber, rowNumber) {
  // 该函数用于把行列号转换回Excel单元格引用。
  return `${columnNumberToName(colNumber)}${rowNumber}`;
}

function columnNameToNumber(name) {
  // 该函数用于把Excel列名转换成数字列号。
  let number = 0;
  for (const char of name) number = number * 26 + char.charCodeAt(0) - 64;
  return number;
}

function columnNumberToName(number) {
  // 该函数用于把数字列号转换成Excel列名。
  let name = "";
  let current = number;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}
