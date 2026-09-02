(() => {
  const { copyTextToClipboard, pageKeyForKind, paginateItems, renderPager } = window.orderBoardHelpers;
  const { clearToggleFeedbackLater, setToggleFeedback } = window.orderToggleFeedback;
  const copyButtonFeedbackByKey = new Map();
  const noteButtonFeedbackByKey = new Map();
  const state = {
    homeSearchText: "",
    handledSearchText: "",
    pageSize: 8,
    handledPageSize: 8,
    pendingPage: 1,
    verifyingPage: 1,
    processingPage: 1,
    handledPage: 1,
    dateRangeDays: 1,
  };
  let elements = {};
  let getRuntimeSnapshot = () => null;
  let requestJson = async () => ({});
  let renderRuntime = () => {};
  let setFeedback = () => {};

  function resetHomePages() {
    state.pendingPage = 1;
    state.verifyingPage = 1;
    state.processingPage = 1;
  }

  function parsePaymentDate(value) {
    // 该函数只从购买时间开头提取日期，避免浏览器按 UTC 解析字符串造成跨天。
    const match = String(value || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function dateStartOfToday() {
    // 该函数统一取本地今天零点，1天就是今天，2天就是今天加昨天。
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function orderMatchesDateRange(order) {
    // 该函数按购买时间做页面分类筛选，后台采集的数据不在这里被删除。
    const orderDate = parsePaymentDate(order.paymentTimeText);
    if (!orderDate) return false;
    const safeDays = Math.max(1, Number(state.dateRangeDays) || 1);
    const end = dateStartOfToday();
    end.setDate(end.getDate() + 1);
    const start = dateStartOfToday();
    start.setDate(start.getDate() - safeDays + 1);
    return orderDate >= start && orderDate < end;
  }

  function normalizeDateRangeDays(value) {
    // 该函数把配置和按钮值收口到现有按钮范围，避免页面出现没有按钮对应的状态。
    const days = Number(value) || 1;
    return [1, 2, 3, 5, 7].includes(days) ? days : 1;
  }

  function dateRangeLabel() {
    if (Number(state.dateRangeDays) === 1) return "今天购买";
    return `最近 ${state.dateRangeDays} 天购买`;
  }

  function syncDateFilterButtons() {
    // 该函数同步首页和已处理页的筛选按钮，避免两个页面看起来状态不一致。
    const selected = String(state.dateRangeDays);
    elements.dateFilterButtons.forEach((button) => {
      const active = button.dataset.orderDateDays === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.title = active ? `当前显示：${dateRangeLabel()}` : `切换为${button.textContent}购买订单`;
    });
  }

  function renderOrderColumn({ kind, orders, list, pager, count, emptyText, pageKey, searchText, pageSize }) {
    const query = window.orderCardModule.normalizeSearchText(searchText);
    const dateFilteredOrders = orders.filter(orderMatchesDateRange);
    const filteredOrders = dateFilteredOrders.filter((order) => window.orderCardModule.orderMatchesSearch(order, query));
    count.textContent = filteredOrders.length !== orders.length ? `${filteredOrders.length}/${orders.length}` : String(orders.length);
    const pageInfo = paginateItems(filteredOrders, state[pageKey], pageSize);
    state[pageKey] = pageInfo.page;
    list.innerHTML = "";
    if (filteredOrders.length === 0) {
      list.textContent = query ? "没有匹配的平台单号。" : (orders.length && dateFilteredOrders.length === 0 ? `当前${dateRangeLabel()}范围没有订单。` : emptyText);
      pager.innerHTML = "";
      return;
    }
    const feedbackStores = { copyButtonFeedbackByKey, noteButtonFeedbackByKey };
    pageInfo.items.forEach((order) => list.appendChild(window.orderCardModule.createOrderArticle(order, feedbackStores)));
    renderPager(pager, kind, pageInfo);
  }

  function renderOrders(orders) {
    const allOrders = Array.isArray(orders) ? orders : [];
    syncDateFilterButtons();
    const pendingOrders = allOrders.filter((order) => !order.handled && !order.verifying && !order.processing);
    const verifyingOrders = allOrders.filter((order) => !order.handled && order.verifying && !order.processing);
    const processingOrders = allOrders.filter((order) => !order.handled && order.processing);
    const handledOrders = allOrders.filter((order) => order.handled);
    renderOrderColumn({
      kind: "pending",
      orders: pendingOrders,
      list: elements.pendingOrderList,
      pager: elements.pendingPager,
      count: elements.pendingCount,
      emptyText: "暂时没有待处理订单。",
      pageKey: "pendingPage",
      searchText: state.homeSearchText,
      pageSize: state.pageSize,
    });
    renderOrderColumn({
      kind: "verifying",
      orders: verifyingOrders,
      list: elements.verifyingOrderList,
      pager: elements.verifyingPager,
      count: elements.verifyingCount,
      emptyText: "暂时没有正在核实订单。",
      pageKey: "verifyingPage",
      searchText: state.homeSearchText,
      pageSize: state.pageSize,
    });
    renderOrderColumn({
      kind: "processing",
      orders: processingOrders,
      list: elements.processingOrderList,
      pager: elements.processingPager,
      count: elements.processingCount,
      emptyText: "暂时没有处理中订单。",
      pageKey: "processingPage",
      searchText: state.homeSearchText,
      pageSize: state.pageSize,
    });
    renderOrderColumn({
      kind: "handled",
      orders: handledOrders,
      list: elements.handledOrderList,
      pager: elements.handledPager,
      count: elements.handledCount,
      emptyText: "暂时没有已处理订单。",
      pageKey: "handledPage",
      searchText: state.handledSearchText,
      pageSize: state.handledPageSize,
    });
  }

  function renderOrdersFromCache() {
    const runtime = getRuntimeSnapshot() || {};
    renderOrders(runtime.problemOrders || []);
  }

  function resetOrderSearch() {
    // 该函数只负责清空搜索状态，避免把搜索逻辑散落到多个事件里。
    state.homeSearchText = "";
    resetHomePages();
    elements.orderSearchInput.value = "";
    renderOrdersFromCache();
  }

  function resetHandledSearch() {
    // 该函数只负责清空已处理页搜索状态，避免影响首页未处理/处理中列表。
    state.handledSearchText = "";
    state.handledPage = 1;
    elements.handledSearchInput.value = "";
    renderOrdersFromCache();
  }

  function clearOrderSearch(button, scope) {
    const isHandledScope = scope === "handled";
    const currentText = isHandledScope ? state.handledSearchText : state.homeSearchText;
    const input = isHandledScope ? elements.handledSearchInput : elements.orderSearchInput;
    if (!currentText && !input.value) {
      window.buttonFeedback.setButtonState(button, {
        text: "已清空",
        title: "当前没有搜索条件，订单列表已经是完整结果。",
        state: "success",
        timeout: 2200,
      });
      return;
    }
    if (isHandledScope) resetHandledSearch();
    else resetOrderSearch();
    window.buttonFeedback.setButtonState(button, {
      text: "已清空",
      title: "搜索内容已清空，已恢复全部订单。",
      state: "success",
      timeout: 2200,
    });
  }

  async function copyOrderNumber(button) {
    const key = button.dataset.copyOrderKey || "";
    window.buttonFeedback.setButtonState(button, { text: "复制中", title: "正在复制平台单号", state: "running", disabled: true });
    try {
      await copyTextToClipboard(button.dataset.copyOrderText);
      copyButtonFeedbackByKey.set(key, { text: "已复制", title: "平台单号已复制到剪贴板", state: "success", expiresAt: Date.now() + 2500 });
      button.textContent = "已复制";
      button.title = "平台单号已复制到剪贴板";
      button.dataset.state = "success";
      window.setTimeout(() => {
        copyButtonFeedbackByKey.delete(key);
        renderOrdersFromCache();
      }, 2500);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "复制失败");
      copyButtonFeedbackByKey.set(key, { text: "复制失败", title: message, state: "error", expiresAt: Date.now() + 3500 });
      button.textContent = "复制失败";
      button.title = message;
      button.dataset.state = "error";
      window.setTimeout(() => {
        copyButtonFeedbackByKey.delete(key);
        renderOrdersFromCache();
      }, 3500);
    } finally {
      button.disabled = false;
    }
  }

  async function editOrderNote(button) {
    const key = button.dataset.noteOrderKey || "";
    const currentNote = button.dataset.noteText || "";
    const nextNote = await window.noteDialogModule.open({ currentNote });
    if (nextNote === null) return;
    await window.buttonFeedback.runButtonAction(button, {
      runningText: "保存中",
      successText: String(nextNote || "").trim() ? "已备注" : "已清除",
      errorText: "备注失败",
    }, async () => {
      const payload = await requestJson("/api/orders/set-note", {
        method: "POST",
        body: JSON.stringify({ key, noteText: nextNote }),
      });
      const noteSaved = String(nextNote || "").trim();
      noteButtonFeedbackByKey.set(key, {
        text: noteSaved ? "已备注" : "已清除",
        title: payload.message || (noteSaved ? "订单备注已保存" : "订单备注已清空"),
        state: "success",
        expiresAt: Date.now() + 2600,
      });
      setFeedback(payload.message, "success");
      if (payload.runtime) renderRuntime(payload.runtime);
      window.setTimeout(() => {
        noteButtonFeedbackByKey.delete(key);
        renderOrdersFromCache();
      }, 2600);
      return payload;
    }).catch((error) => setFeedback(error.message, "error"));
  }

  async function setOrderProcessing(input) {
    const nextProcessing = Boolean(input.checked);
    setToggleFeedback(input, "running");
    input.disabled = true;
    try {
      const payload = await requestJson("/api/orders/set-processing", {
        method: "POST",
        body: JSON.stringify({ key: input.dataset.processingOrderKey, processing: nextProcessing }),
      });
      setToggleFeedback(input, "success");
      setFeedback(payload.message, "success");
      if (payload.runtime) renderRuntime(payload.runtime);
      else {
        input.disabled = false;
        clearToggleFeedbackLater(input, 1600);
      }
    } catch (error) {
      input.checked = !nextProcessing;
      input.disabled = false;
      setToggleFeedback(input, "error");
      clearToggleFeedbackLater(input, 3200);
      setFeedback(error.message, "error");
    }
  }

  async function setOrderVerifying(input) {
    const nextVerifying = Boolean(input.checked);
    setToggleFeedback(input, "running");
    input.disabled = true;
    try {
      const payload = await requestJson("/api/orders/set-verifying", {
        method: "POST",
        body: JSON.stringify({ key: input.dataset.verifyingOrderKey, verifying: nextVerifying }),
      });
      setToggleFeedback(input, "success");
      setFeedback(payload.message, "success");
      if (payload.runtime) renderRuntime(payload.runtime);
      else {
        input.disabled = false;
        clearToggleFeedbackLater(input, 1600);
      }
    } catch (error) {
      input.checked = !nextVerifying;
      input.disabled = false;
      setToggleFeedback(input, "error");
      clearToggleFeedbackLater(input, 3200);
      setFeedback(error.message, "error");
    }
  }

  async function setOrderHandled(input) {
    const nextHandled = Boolean(input.checked);
    setToggleFeedback(input, "running");
    input.disabled = true;
    try {
      const payload = await requestJson("/api/orders/set-handled", {
        method: "POST",
        body: JSON.stringify({ key: input.dataset.handledOrderKey, handled: nextHandled }),
      });
      setToggleFeedback(input, "success");
      setFeedback(payload.message, "success");
      if (payload.runtime) renderRuntime(payload.runtime);
      else {
        input.disabled = false;
        clearToggleFeedbackLater(input, 1600);
      }
    } catch (error) {
      input.checked = !nextHandled;
      input.disabled = false;
      setToggleFeedback(input, "error");
      clearToggleFeedbackLater(input, 3200);
      setFeedback(error.message, "error");
    }
  }

  function handleSearchInput(scope) {
    if (scope === "handled") {
      state.handledSearchText = elements.handledSearchInput.value;
      state.handledPage = 1;
    } else {
      state.homeSearchText = elements.orderSearchInput.value;
      resetHomePages();
    }
    renderOrdersFromCache();
  }

  function handlePageSizeChange(scope) {
    if (scope === "handled") {
      state.handledPageSize = Number(elements.handledPageSizeSelect.value) || 8;
      state.handledPage = 1;
    } else {
      state.pageSize = Number(elements.orderPageSizeSelect.value) || 8;
      resetHomePages();
    }
    renderOrdersFromCache();
  }

  function handleDateFilterClick(button) {
    // 该函数切换购买时间范围，只影响页面展示，不改变后台采集到的订单数据。
    const days = normalizeDateRangeDays(button.dataset.orderDateDays);
    state.dateRangeDays = days;
    resetHomePages();
    state.handledPage = 1;
    syncDateFilterButtons();
    renderOrdersFromCache();
    setFeedback(`已切换为${dateRangeLabel()}订单。`, "success");
  }

  function setConfiguredDateRangeDays(value) {
    // 该函数让页面默认购买时间范围跟随通知配置，避免收到通知后列表默认看不到订单。
    const days = normalizeDateRangeDays(value);
    const changed = state.dateRangeDays !== days;
    state.dateRangeDays = days;
    syncDateFilterButtons();
    if (!changed) return;
    resetHomePages();
    state.handledPage = 1;
    renderOrdersFromCache();
  }

  async function handleOrderBoardClick(event) {
    if (!(event.target instanceof Element)) return;
    const pageButton = event.target.closest("[data-page-kind][data-page-target]");
    if (pageButton) {
      state[pageKeyForKind(pageButton.dataset.pageKind)] = Number(pageButton.dataset.pageTarget) || 1;
      renderOrdersFromCache();
      return;
    }
    const button = event.target.closest("[data-copy-order-text]");
    if (button) await copyOrderNumber(button);
    const noteButton = event.target.closest("[data-note-order-key]");
    if (noteButton) await editOrderNote(noteButton);
  }

  async function handleOrderBoardChange(event) {
    if (!(event.target instanceof Element)) return;
    const processingInput = event.target.closest("[data-processing-order-key]");
    if (processingInput) {
      await setOrderProcessing(processingInput);
      return;
    }
    const verifyingInput = event.target.closest("[data-verifying-order-key]");
    if (verifyingInput) {
      await setOrderVerifying(verifyingInput);
      return;
    }
    const input = event.target.closest("[data-handled-order-key]");
    if (input) await setOrderHandled(input);
  }

  function attachOrderBoardEvents(container) {
    container.addEventListener("click", handleOrderBoardClick);
    container.addEventListener("change", handleOrderBoardChange);
  }

  function attachEvents() {
    elements.orderSearchInput.addEventListener("input", () => {
      handleSearchInput("home");
    });
    elements.handledSearchInput.addEventListener("input", () => {
      handleSearchInput("handled");
    });
    elements.clearOrderSearchButton.addEventListener("click", () => clearOrderSearch(elements.clearOrderSearchButton, "home"));
    elements.clearHandledSearchButton.addEventListener("click", () => clearOrderSearch(elements.clearHandledSearchButton, "handled"));
    elements.orderPageSizeSelect.addEventListener("change", () => {
      handlePageSizeChange("home");
    });
    elements.handledPageSizeSelect.addEventListener("change", () => {
      handlePageSizeChange("handled");
    });
    elements.dateFilterButtons.forEach((button) => {
      button.addEventListener("click", () => handleDateFilterClick(button));
    });
    attachOrderBoardEvents(elements.orderBoard);
    attachOrderBoardEvents(elements.handledBoard);
  }

  function init(options) {
    elements = options.elements;
    getRuntimeSnapshot = options.getRuntimeSnapshot;
    requestJson = options.requestJson;
    renderRuntime = options.renderRuntime;
    setFeedback = options.setFeedback;
    attachEvents();
  }

  window.orderBoardModule = { init, renderOrders, setConfiguredDateRangeDays };
})();
