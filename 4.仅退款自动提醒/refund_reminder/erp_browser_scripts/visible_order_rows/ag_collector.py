# 该文件用于保存可见订单行扫描脚本的 AG Grid 采集片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_AG_COLLECTOR = r"""
  function elementKey(node, fallbackIndex) {
    if (!node || !node.getAttribute) return String(fallbackIndex);
    return String(
      node.getAttribute("col-id") ||
      node.getAttribute("data-col-id") ||
      node.getAttribute("aria-colindex") ||
      node.getAttribute("field") ||
      fallbackIndex
    );
  }

  function collectFromAgGrid(root) {
    const currentScrollLeft = Number(
      (root.querySelector(".ag-body-horizontal-scroll-viewport,.ag-center-cols-viewport,.ag-body-viewport") || {}).scrollLeft || 0
    );
    const headerEntries = [];
    const seenKeys = new Set();
    const headerCells = Array.from(root.querySelectorAll(".ag-header-cell"))
      .filter(isVisible)
      .filter((cell) => !cell.closest(".ag-floating-filter, .ag-floating-filter-body, .ag-header-row-column-filter"));
    for (const cell of headerCells) {
      const textNode = cell.querySelector(".ag-header-cell-text") || cell;
      const text = textOf(textNode);
      if (!text) continue;
      const key = elementKey(cell, headerEntries.length);
      const rect = cell.getBoundingClientRect();
      const order = Number(cell.getAttribute("aria-colindex") || "");
      const uniqueKey = `${key}:${normalizeHeader(text)}:${Math.round(rect.left)}`;
      if (seenKeys.has(uniqueKey)) continue;
      seenKeys.add(uniqueKey);
      headerEntries.push({ key, text, left: rect.left + currentScrollLeft, order: Number.isFinite(order) && order > 0 ? order : null });
    }
    headerEntries.sort((a, b) => ((a.order || 0) - (b.order || 0)) || (a.left - b.left));
    const headers = headerEntries.map((item) => item.text);
    if (!looksLikeOrderGrid(headers)) return null;

    const rowMaps = new Map();
    const rowNodes = Array.from(root.querySelectorAll(".ag-center-cols-container .ag-row,.ag-pinned-left-cols-container .ag-row,.ag-pinned-right-cols-container .ag-row"))
      .filter(isVisible)
      .filter((row) => !row.closest(".ag-header, .ag-floating-filter"));
    for (const row of rowNodes) {
      const rawIndex = row.getAttribute("row-index") || row.getAttribute("aria-rowindex") || String(rowMaps.size);
      const rowIndex = Number(rawIndex);
      if (!Number.isFinite(rowIndex)) continue;
      const rowMap = rowMaps.get(rowIndex) || {};
      const cells = Array.from(row.querySelectorAll(".ag-cell"))
        .filter(isVisible)
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
        const cell = cells[cellIndex];
        const key = elementKey(cell, cellIndex);
        const value = textOf(cell);
        if (value) rowMap[key] = rowMap[key] ? `${rowMap[key]} ${value}` : value;
        else if (!(key in rowMap)) rowMap[key] = "";
      }
      rowMaps.set(rowIndex, rowMap);
    }
    const rows = Array.from(rowMaps.entries())
      .sort((a, b) => a[0] - b[0])
      .map((entry) => headerEntries.map((header) => entry[1][header.key] || ""))
      .filter((row) => row.some(Boolean));
    return { source: "visible-ag-grid", headers, rows };
  }
"""

__all__ = ["VISIBLE_ORDER_ROWS_AG_COLLECTOR"]

