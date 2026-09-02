(() => {
  async function copyTextToClipboard(text) {
    const value = String(text || "").trim();
    if (!value) throw new Error("当前没有可复制的内容。");
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const helper = document.createElement("textarea");
    helper.value = value;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();
    // 与 app.js 的 copyTextWithTextarea 对齐：execCommand 失败必须抛错，
    // 否则调用方会把复制失败当成成功提示「已复制」。
    const copied = document.execCommand("copy");
    helper.remove();
    if (!copied) throw new Error("浏览器拒绝复制到剪贴板");
  }

  function paginateItems(items, page, pageSize) {
    const safePageSize = Math.max(1, Number(pageSize) || 8);
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const start = (safePage - 1) * safePageSize;
    return {
      items: items.slice(start, start + safePageSize),
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages,
    };
  }

  function orderKindLabel(kind) {
    if (kind === "handled") return "已处理";
    if (kind === "processing") return "处理中";
    if (kind === "verifying") return "正在核实";
    return "未处理";
  }

  function pageKeyForKind(kind) {
    if (kind === "handled") return "handledPage";
    if (kind === "processing") return "processingPage";
    if (kind === "verifying") return "verifyingPage";
    return "pendingPage";
  }

  function renderPager(container, kind, pageInfo) {
    container.innerHTML = "";
    if (pageInfo.total <= pageInfo.pageSize) return;
    const label = orderKindLabel(kind);
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "pager-button";
    prev.textContent = "上一页";
    prev.title = `${label}订单上一页`;
    prev.disabled = pageInfo.page <= 1;
    prev.dataset.pageKind = kind;
    prev.dataset.pageTarget = String(pageInfo.page - 1);

    const status = document.createElement("span");
    status.className = "pager-status";
    status.textContent = `${pageInfo.page}/${pageInfo.totalPages}｜共 ${pageInfo.total} 条`;

    const next = document.createElement("button");
    next.type = "button";
    next.className = "pager-button";
    next.textContent = "下一页";
    next.title = `${label}订单下一页`;
    next.disabled = pageInfo.page >= pageInfo.totalPages;
    next.dataset.pageKind = kind;
    next.dataset.pageTarget = String(pageInfo.page + 1);

    container.append(prev, status, next);
  }

  window.orderBoardHelpers = {
    copyTextToClipboard,
    pageKeyForKind,
    paginateItems,
    renderPager,
  };
})();
