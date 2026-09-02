# 该文件用于保存可见订单行扫描脚本的控制列对齐片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_ALIGNMENT = r"""
  function looksLikeControlCell(value, rowIndex, cellIndex) {
    const text = normalizeHeader(value);
    if (!text) return true;
    if (text === String(rowIndex + 1) || text === String(cellIndex + 1)) return true;
    return /^(选择|勾选|序号|全选|操作)$/.test(text);
  }

  function alignRowsToHeaders(headers, rows) {
    const headerCount = (headers || []).length;
    if (headerCount <= 0) return rows || [];
    return (rows || []).map((row, rowIndex) => {
      const cells = Array.from(row || []);
      if (cells.length <= headerCount) return cells;
      const extraCount = cells.length - headerCount;
      const leadingCells = cells.slice(0, extraCount);
      if (leadingCells.every((value, cellIndex) => looksLikeControlCell(value, rowIndex, cellIndex))) {
        return cells.slice(extraCount);
      }
      return cells.slice(0, headerCount);
    });
  }

  function usable(candidate) {
    if (!candidate || !candidate.headers || !candidate.rows) return false;
    return candidate.rows.length > 0 && looksLikeOrderGrid(candidate.headers);
  }
"""

__all__ = ["VISIBLE_ORDER_ROWS_ALIGNMENT"]

