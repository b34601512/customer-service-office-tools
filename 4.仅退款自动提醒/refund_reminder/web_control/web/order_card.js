(() => {
  function normalizeSearchText(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function orderMatchesSearch(order, query) {
    if (!query) return true;
    const haystack = [
      order.platformOrderNumber,
      order.copyOrderNumber,
      order.shopName,
      order.orderSourceText,
      order.allocationStatusText,
      order.shippingStatusText,
      order.auditStatusText,
      order.sellerRemarkText,
      order.paymentTimeText,
      order.refundStatusText,
      order.addedAtText,
      order.noteText,
    ].map(normalizeSearchText).join(" ");
    return haystack.includes(query);
  }

  function buildOrderInfoItems(order) {
    return [
      ["店铺", order.shopName],
      ["来源", order.orderSourceText],
      ["配货", order.allocationStatusText],
      ["发货", order.shippingStatusText],
      ["审核", order.auditStatusText],
      ["卖家备注", order.sellerRemarkText],
    ].filter((item) => String(item[1] || "").trim());
  }

  function buildOrderMeta(order) {
    const parts = [];
    if (order.paymentTimeText) parts.push(`支付：${order.paymentTimeText}`);
    if (order.refundStatusText) parts.push(`退款：${order.refundStatusText}`);
    if (!order.handled && order.addedAtText) parts.push(`添加时间：${order.addedAtText}`);
    if (order.handled && order.markedAtText) parts.push(`处理时间：${order.markedAtText}`);
    return parts.join("｜");
  }

  function buildOrderTitle(order) {
    return `平台单号：${order.platformOrderNumber || "未识别"}`;
  }

  function activeButtonState(feedbackByKey, order) {
    const key = order.key || "";
    const buttonState = feedbackByKey.get(key);
    if (buttonState && buttonState.expiresAt <= Date.now()) feedbackByKey.delete(key);
    return feedbackByKey.get(key);
  }

  function appendStatusBadge(titleRow, order) {
    // 该函数只负责给未完成卡片补充当前处理阶段，避免用户在三列之间看混。
    if (order.handled) return;
    const badge = document.createElement("span");
    if (order.processing) {
      badge.className = "order-status-badge processing";
      badge.textContent = "处理中";
    } else if (order.verifying) {
      badge.className = "order-status-badge verifying";
      badge.textContent = "正在核实";
    } else {
      return;
    }
    titleRow.append(badge);
  }

  function appendNoteBadge(titleRow, noteText) {
    // 该函数用于把有备注订单直接标到标题行，避免用户只靠底部备注文字识别。
    if (!noteText) return;
    const badge = document.createElement("span");
    badge.className = "order-note-badge";
    badge.textContent = "有备注";
    badge.title = `当前备注：${noteText}`;
    titleRow.append(badge);
  }

  function appendOrderNote(main, noteText) {
    // 该函数只负责渲染备注，备注为空时不占页面空间。
    if (!noteText) return;
    const note = document.createElement("span");
    note.className = "order-note";
    note.textContent = `备注：${noteText}`;
    main.appendChild(note);
  }

  function appendOrderInfoGrid(main, order) {
    // 该函数把业务判断字段固定展示在卡片顶部，避免用户只看到单号还要回 ERP 对照。
    const infoItems = buildOrderInfoItems(order);
    if (infoItems.length === 0) return;
    const grid = document.createElement("div");
    grid.className = "order-info-grid";
    infoItems.forEach(([labelText, valueText]) => {
      const item = document.createElement("span");
      item.className = "order-info-chip";
      const label = document.createElement("b");
      label.textContent = labelText;
      const value = document.createElement("span");
      value.textContent = valueText;
      item.append(label, value);
      grid.appendChild(item);
    });
    main.appendChild(grid);
  }

  function createCopyButton(order, feedbackStores) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-button";
    const copyText = order.copyOrderNumber || order.platformOrderNumber || "";
    const activeState = activeButtonState(feedbackStores.copyButtonFeedbackByKey, order);
    button.textContent = activeState ? activeState.text : (copyText ? "复制平台单号" : "未识别单号");
    button.title = activeState ? activeState.title : (copyText ? `复制平台单号：${copyText}` : "当前订单没有可复制的平台单号");
    button.dataset.copyOrderText = copyText;
    button.dataset.copyOrderKey = order.key || "";
    button.dataset.state = activeState ? activeState.state : "";
    button.disabled = !copyText;
    return button;
  }

  function createNoteButton(order, noteText, feedbackStores) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `small-button note-button${noteText ? " has-note" : ""}`;
    const activeState = activeButtonState(feedbackStores.noteButtonFeedbackByKey, order);
    button.textContent = activeState ? activeState.text : (noteText ? "改备注" : "备注");
    button.title = activeState ? activeState.title : (noteText ? `当前备注：${noteText}` : "添加订单备注");
    button.dataset.noteOrderKey = order.key || "";
    button.dataset.noteText = noteText;
    button.dataset.state = activeState ? activeState.state : "";
    button.disabled = !order.key;
    return button;
  }

  function createProcessingToggle(order) {
    const label = document.createElement("label");
    label.className = "processing-toggle";
    label.title = order.processing ? "取消后订单回到未处理列表" : "转入处理中列表";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(order.processing);
    input.disabled = !order.key || Boolean(order.handled);
    input.dataset.processingOrderKey = order.key || "";
    label.append(input, document.createTextNode(order.processing ? " 处理中" : " 转处理中"));
    return label;
  }

  function createVerifyingToggle(order) {
    const label = document.createElement("label");
    label.className = "verifying-toggle";
    label.title = order.verifying ? "取消后订单回到未处理列表" : "移入正在核实列表";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(order.verifying);
    input.disabled = !order.key || Boolean(order.handled) || Boolean(order.processing);
    input.dataset.verifyingOrderKey = order.key || "";
    label.append(input, document.createTextNode(order.verifying ? " 正在核实" : " 开始处理"));
    return label;
  }

  function createHandledToggle(order) {
    const label = document.createElement("label");
    label.className = "handled-toggle";
    label.title = "切换后会立即保存人工处理状态";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(order.handled);
    input.disabled = !order.key;
    input.dataset.handledOrderKey = order.key || "";
    label.append(input, document.createTextNode(" 已人工处理"));
    return label;
  }

  function createOrderArticle(order, feedbackStores) {
    const article = document.createElement("article");
    const statusClass = order.handled ? "handled" : (order.processing ? "processing" : (order.verifying ? "verifying" : "pending"));
    const noteText = String(order.noteText || "").trim();
    article.className = `order-item ${statusClass}${noteText ? " has-note" : ""}`;

    const main = document.createElement("div");
    main.className = "order-main";
    const titleRow = document.createElement("div");
    titleRow.className = "order-title-row";
    const title = document.createElement("strong");
    title.textContent = buildOrderTitle(order);
    titleRow.append(title);
    appendNoteBadge(titleRow, noteText);
    appendStatusBadge(titleRow, order);

    const meta = document.createElement("span");
    meta.className = "order-meta";
    meta.textContent = buildOrderMeta(order);
    main.append(titleRow);
    appendOrderInfoGrid(main, order);
    main.append(meta);

    appendOrderNote(main, noteText);

    const actions = document.createElement("div");
    actions.className = "order-actions";
    actions.append(createCopyButton(order, feedbackStores), createNoteButton(order, noteText, feedbackStores));
    if (!order.handled && !order.processing) actions.appendChild(createVerifyingToggle(order));
    if (!order.handled && (order.verifying || order.processing)) actions.appendChild(createProcessingToggle(order));
    actions.appendChild(createHandledToggle(order));

    article.append(main, actions);
    return article;
  }

  window.orderCardModule = {
    createOrderArticle,
    normalizeSearchText,
    orderMatchesSearch,
  };
})();
