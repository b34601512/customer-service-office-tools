// 该文件用于统一汇总表读写两端的表头定位与单元格读取逻辑，避免双份实现漂移。
function normalizeText(value) {
  return String(value ?? "").trim();
}

function resolveHeaderColumns(headerCells, requiredHeaders) {
  const headerColumns = new Map();
  for (const [columnIndex, cell] of headerCells.entries()) {
    const header = normalizeText(cell.value);
    if (header) headerColumns.set(header, columnIndex);
  }
  for (const requiredHeader of requiredHeaders) {
    if (!headerColumns.has(requiredHeader)) {
      throw new Error(`统一数据源缺少列「${requiredHeader}」。`);
    }
  }
  return headerColumns;
}

function readCell(cells, headerColumns, header) {
  return cells.get(headerColumns.get(header))?.value ?? null;
}

module.exports = {
  normalizeText,
  resolveHeaderColumns,
  readCell
};
