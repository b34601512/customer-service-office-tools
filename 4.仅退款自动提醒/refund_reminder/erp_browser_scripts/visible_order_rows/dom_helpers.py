# 该文件用于保存可见订单行扫描脚本的 DOM 通用工具片段。
from __future__ import annotations

VISIBLE_ORDER_ROWS_DOM_HELPERS = r"""
  function stripHtml(value) {
    const box = document.createElement("div");
    box.innerHTML = String(value || "");
    return String(box.innerText || box.textContent || value || "");
  }

  function textOf(node) {
    const visible = String((node && (node.innerText || node.textContent)) || "").replace(/\s+/g, " ").trim();
    const attrs = ["title", "data-qtip", "aria-label", "data-original-title"]
      .map((name) => node && node.getAttribute && node.getAttribute(name))
      .map(stripHtml)
      .map((value) => String(value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const longestAttr = attrs.sort((a, b) => b.length - a.length)[0] || "";
    if (longestAttr && longestAttr.length > visible.length) return longestAttr;
    return visible || longestAttr;
  }

  function normalizeHeader(value) {
    return String(value || "").replace(/[\s:：]+/g, "").trim();
  }

  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  function findIndex(headers, names) {
    const cleanHeaders = headers.map(normalizeHeader);
    for (const name of names) {
      const exact = cleanHeaders.indexOf(name);
      if (exact >= 0) return exact;
    }
    return cleanHeaders.findIndex((header) => names.some((name) => name && header.includes(name)));
  }

  function markerCount(headers) {
    const cleanHeaders = headers.map(normalizeHeader);
    const names = Array.from(new Set([...orderNames, ...orderGridMarkerNames]));
    return names.filter((name) => cleanHeaders.some((header) => name && (header === name || header.includes(name)))).length;
  }

  function looksLikeOrderGrid(headers) {
    if (findIndex(headers, orderNames) >= 0) return true;
    return markerCount(headers) >= 2;
  }
"""

__all__ = ["VISIBLE_ORDER_ROWS_DOM_HELPERS"]

