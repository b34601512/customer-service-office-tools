# 该文件用于保存可见订单行扫描脚本的主执行流程片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_ENTRY_FLOW = r"""
  const candidates = [];
  for (const root of Array.from(document.querySelectorAll(".ag-root,.ag-root-wrapper,.ag-theme-balham,.ag-theme-alpine")).filter(isVisible)) {
    candidates.push(collectFromAgGrid(root));
  }
  for (const root of Array.from(document.querySelectorAll(".datagrid-wrap,.datagrid-view")).filter(isVisible)) {
    candidates.push(collectFromEasyuiGrid(root));
  }
  for (const root of Array.from(document.querySelectorAll(".x-grid,.x-panel,.x-grid-view,.x-grid-with-row-lines,.x-grid3")).filter(isVisible)) {
    candidates.push(collectFromExtGrid(root));
  }
  for (const root of Array.from(document.querySelectorAll("[role='grid'],[role='treegrid']")).filter(isVisible)) {
    candidates.push(collectFromRoleGrid(root));
  }
  candidates.push(collectFromRoleGrid(document));
  for (const table of Array.from(document.querySelectorAll("table")).filter(isVisible)) candidates.push(collectFromTable(table));
  const valid = candidates.filter(usable).sort((a, b) => score(b) - score(a));
  if (valid.length > 0) {
    const best = valid[0];
    best.candidate_sources = valid.slice(0, 8).map((item) => `${item.source}:表头${(item.headers || []).length}/行${(item.rows || []).length}`);
    return best;
  }
  return { source: "visible-order-not-found", headers: [], rows: [], pageText: textOf(document.body).slice(0, 1200), candidate_sources: summarizeCandidates() };
}
"""

__all__ = ["VISIBLE_ORDER_ROWS_ENTRY_FLOW"]

