# 该文件用于保存可见订单行扫描脚本的 EasyUI、表格、角色表和 Ext Grid 采集片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_OTHER_COLLECTORS = r"""
  function collectFromEasyuiGrid(root) {
    const headerEntries = [];
    const seenFields = new Set();
    const headerCells = Array.from(root.querySelectorAll(".datagrid-header td[field]"))
      .filter(isVisible)
      .filter((cell) => !cell.closest(".datagrid-filter-row"));
    for (const cell of headerCells) {
      const field = String(cell.getAttribute("field") || "").trim();
      const text = textOf(cell);
      if (!field || !text || seenFields.has(field)) continue;
      seenFields.add(field);
      headerEntries.push({ field, text });
    }
    const headers = headerEntries.map((item) => item.text);
    if (!looksLikeOrderGrid(headers)) return null;

    const rowMaps = new Map();
    const bodyRows = Array.from(root.querySelectorAll(".datagrid-body tr[datagrid-row-index],.datagrid-body tr[datagrid-rowindex]"))
      .filter(isVisible)
      .filter((row) => !row.closest(".datagrid-footer"));
    for (const row of bodyRows) {
      const rawIndex = row.getAttribute("datagrid-row-index") || row.getAttribute("datagrid-rowindex") || "";
      const rowIndex = Number(rawIndex);
      if (!Number.isFinite(rowIndex)) continue;
      const rowMap = rowMaps.get(rowIndex) || {};
      for (const cell of Array.from(row.querySelectorAll("td[field]")).filter(isVisible)) {
        const field = String(cell.getAttribute("field") || "").trim();
        if (!seenFields.has(field)) continue;
        const value = textOf(cell);
        if (value) rowMap[field] = rowMap[field] ? `${rowMap[field]} ${value}` : value;
        else if (!(field in rowMap)) rowMap[field] = "";
      }
      rowMaps.set(rowIndex, rowMap);
    }
    const rows = Array.from(rowMaps.entries())
      .sort((a, b) => a[0] - b[0])
      .map((entry) => headerEntries.map((header) => entry[1][header.field] || ""))
      .filter((row) => row.some(Boolean));
    return { source: "visible-easyui-grid", headers, rows };
  }

  function collectFromTable(table) {
    const rowTexts = Array.from(table.querySelectorAll("tr"))
      .filter(isVisible)
      .map((row) => Array.from(row.querySelectorAll("th,td")).filter(isVisible).map(textOf))
      .filter((cells) => cells.length > 0);
    for (let index = 0; index < rowTexts.length; index += 1) {
      const headers = rowTexts[index];
      if (looksLikeOrderGrid(headers)) {
        return { source: "visible-table", headers, rows: rowTexts.slice(index + 1).filter((row) => row.some(Boolean)) };
      }
    }
    return null;
  }

  function collectFromRoleGrid(root) {
    const rowTexts = Array.from(root.querySelectorAll('[role="row"]'))
      .filter(isVisible)
      .filter((row) => !row.closest(".ag-header, .ag-floating-filter, .ag-header-row-column-filter"))
      .map((row) =>
        Array.from(row.querySelectorAll('[role="columnheader"],[role="gridcell"],[role="cell"]')).filter(isVisible).map(textOf)
      )
      .filter((cells) => cells.length > 0);
    for (let index = 0; index < rowTexts.length; index += 1) {
      const headers = rowTexts[index];
      if (looksLikeOrderGrid(headers)) {
        return { source: "visible-role-grid", headers, rows: rowTexts.slice(index + 1).filter((row) => row.some(Boolean)) };
      }
    }
    return null;
  }

  function collectFromExtGrid(root) {
    const headerEntries = [];
    const seenKeys = new Set();
    const headerCells = Array.from(root.querySelectorAll(".x-column-header,.x-grid-header-ct .x-column-header,.x-grid3-hd"))
      .filter(isVisible);
    for (const cell of headerCells) {
      const text = textOf(cell.querySelector(".x-column-header-text,.x-grid3-hd-inner") || cell);
      if (!text) continue;
      const key = elementKey(cell, headerEntries.length);
      const rect = cell.getBoundingClientRect();
      const uniqueKey = `${key}:${normalizeHeader(text)}:${Math.round(rect.left)}`;
      if (seenKeys.has(uniqueKey)) continue;
      seenKeys.add(uniqueKey);
      headerEntries.push({ key, text, left: rect.left });
    }
    headerEntries.sort((a, b) => a.left - b.left);
    const headers = headerEntries.map((item) => item.text);
    if (!looksLikeOrderGrid(headers)) return null;

    const rows = Array.from(root.querySelectorAll(".x-grid-item,.x-grid-row,.x-grid3-row"))
      .filter(isVisible)
      .map((row) =>
        Array.from(row.querySelectorAll(".x-grid-cell,.x-grid3-cell,td")).filter(isVisible).map(textOf)
      )
      .filter((cells) => cells.length > 0 && cells.some(Boolean));
    return { source: "visible-ext-grid", headers, rows: alignRowsToHeaders(headers, rows) };
  }
"""

__all__ = ["VISIBLE_ORDER_ROWS_OTHER_COLLECTORS"]

