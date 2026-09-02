# 该文件用于保存可见订单行扫描脚本的候选源摘要和排序片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_CANDIDATE_SCORING = r"""
  function summarizeCandidates() {
    const selectors = [
      ".ag-root,.ag-root-wrapper,.ag-theme-balham,.ag-theme-alpine",
      ".datagrid-wrap,.datagrid-view",
      ".x-grid,.x-panel,.x-grid-view,.x-grid-with-row-lines,.x-grid3",
      "[role='grid'],[role='treegrid']",
      "table",
    ];
    return selectors.map((selector) => {
      const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (nodes.length <= 0) return `${selector}:0`;
      const first = nodes[0];
      const headerCount = first.querySelectorAll(".ag-header-cell,.datagrid-header td[field],.x-column-header,.x-grid3-hd,[role='columnheader'],th").length;
      const rowCount = first.querySelectorAll(".ag-row,.datagrid-body tr,.x-grid-item,.x-grid-row,.x-grid3-row,[role='row'],tr").length;
      return `${selector}:${nodes.length}/表头${headerCount}/行${rowCount}/片段${textOf(first).slice(0, 80)}`;
    });
  }

  function sourcePriority(candidate) {
    const source = String((candidate && candidate.source) || "");
    if (source.includes("ag-grid")) return 1000;
    if (source.includes("easyui")) return 900;
    if (source.includes("ext-grid")) return 850;
    if (source.includes("table")) return 600;
    if (source.includes("role-grid")) return 500;
    return 0;
  }

  function score(candidate) {
    if (!usable(candidate)) return -1;
    return sourcePriority(candidate) * 100000 + markerCount(candidate.headers || []) * 1000 + (candidate.rows || []).length * 10 + (candidate.headers || []).length;
  }
"""

__all__ = ["VISIBLE_ORDER_ROWS_CANDIDATE_SCORING"]

