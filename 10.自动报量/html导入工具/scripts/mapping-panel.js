// 该文件用于管理产品行、店铺名和料号映射，计算引擎只读取保存后的配置。
function openMappingView() {
  // 该函数用于打开映射弹窗，让客服在不接触代码文件的情况下维护料号映射。
  closeCalendarPopup();
  if (typeof setConfigDialogVisible === "function") setConfigDialogVisible(false);
  pageState.mappingRows = normalizeProductRows(readConfigForm().productRows);
  pageState.mappingEditIndex = -1;
  document.getElementById("mappingSearchInput").value = "";
  setMappingFeedback(`已加载 ${pageState.mappingRows.length} 条映射。`);
  hideMappingEditor();
  renderMappingList();
  setMappingDialogVisible(true);
  document.getElementById("mappingSearchInput").focus();
}

function closeMappingView() {
  // 该函数用于关闭映射弹窗并回到主页面。
  hideMappingEditor(false);
  setMappingDialogVisible(false);
  document.getElementById("toggleMappingButton").focus();
}

function setMappingDialogVisible(isVisible) {
  // 该函数用于统一控制映射弹窗显隐，避免按钮状态和遮罩状态不一致。
  const panel = document.getElementById("mappingPanel");
  panel.classList.toggle("hidden", !isVisible);
  panel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  document.body.classList.toggle("modal-open", isVisible);
  document.getElementById("toggleMappingButton").setAttribute("aria-expanded", isVisible ? "true" : "false");
}

function closeMappingWhenClickOutside(event) {
  // 该函数用于点击遮罩关闭映射弹窗，避免误触弹窗内容时丢失正在编辑的数据。
  if (event.target === document.getElementById("mappingPanel")) {
    closeMappingView();
  }
}

function closeMappingWhenPressEscape(event) {
  // 该函数用于按Esc关闭映射弹窗，保持和配置弹窗一致的操作习惯。
  if (
    event.key === "Escape"
    && !document.getElementById("mappingPanel").classList.contains("hidden")
    && document.getElementById("mappingEditorPanel").classList.contains("hidden")
  ) {
    closeMappingView();
  }
}

function setMappingFeedback(message) {
  // 该函数用于在映射弹窗内反馈当前动作结果，避免用户不知道按钮是否生效。
  document.getElementById("mappingFeedback").textContent = message;
}

function renderMappingList() {
  // 该函数用于按搜索条件渲染映射列表，不改变原始映射数据。
  const keyword = cleanCell(document.getElementById("mappingSearchInput").value).toLowerCase();
  const tbody = document.getElementById("mappingTableBody");
  tbody.textContent = "";
  const visibleRows = pageState.mappingRows
    .map((productRow, index) => ({ productRow, index }))
    .filter((item) => isMappingMatched(item.productRow, keyword));
  document.getElementById("mappingCountText").textContent = `${visibleRows.length}/${pageState.mappingRows.length}条映射`;
  if (visibleRows.length === 0) {
    appendEmptyMappingRow(tbody);
    return;
  }
  for (const item of visibleRows) {
    tbody.appendChild(createMappingTableRow(item.productRow, item.index));
  }
}

function isMappingMatched(productRow, keyword) {
  // 该函数用于判断一条映射是否命中搜索词，搜索为空时显示全部。
  if (!keyword) return true;
  const text = [
    productRow.row,
    productRow.productName,
    productRow.stores.join(" "),
    productRow.materialCodes.join(" "),
  ].join(" ").toLowerCase();
  return text.includes(keyword);
}

function appendEmptyMappingRow(tbody) {
  // 该函数用于在搜索无结果时给出明确反馈，避免空白表格被误认为坏了。
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 5;
  cell.textContent = "没有找到匹配的映射。";
  row.appendChild(cell);
  tbody.appendChild(row);
}

function createMappingTableRow(productRow, index) {
  // 该函数用于把一条映射转换成表格行，按钮操作通过索引回到原始数组。
  const row = document.createElement("tr");
  row.appendChild(createTextCell(String(productRow.row)));
  row.appendChild(createTextCell(productRow.productName));
  row.appendChild(createTextCell(productRow.stores.join("\n"), "mapping-cell-lines"));
  row.appendChild(createTextCell(productRow.materialCodes.join("\n"), "mapping-cell-lines"));
  row.appendChild(createActionCell(index));
  return row;
}

function createTextCell(text, className) {
  // 该函数用于创建纯文本单元格，避免把配置内容当HTML插入页面。
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  return cell;
}

function createActionCell(index) {
  // 该函数用于创建映射行操作按钮，把增删改集中放在同一列。
  const cell = document.createElement("td");
  const actions = document.createElement("div");
  actions.className = "mapping-row-actions";
  actions.append(
    createMappingActionButton("编辑", "edit", index, "ghost-button"),
    createMappingActionButton("复制", "copy", index, "ghost-button"),
    createMappingActionButton("删除", "delete", index, "danger-button"),
  );
  cell.appendChild(actions);
  return cell;
}

function createMappingActionButton(text, action, index, extraClass) {
  // 该函数用于创建带动作标记的小按钮，减少每行重复绑定事件。
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = `small-button ${extraClass}`;
  button.dataset.mappingAction = action;
  button.dataset.mappingIndex = String(index);
  return button;
}

function handleMappingTableClick(event) {
  // 该函数用于处理映射表格里的编辑、复制、删除按钮点击。
  const button = event.target.closest("button[data-mapping-action]");
  if (!button) return;
  const index = Number(button.dataset.mappingIndex);
  if (!Number.isInteger(index) || !pageState.mappingRows[index]) return;
  if (button.dataset.mappingAction === "edit") editMappingRow(index);
  if (button.dataset.mappingAction === "copy") duplicateMappingRow(index);
  if (button.dataset.mappingAction === "delete") deleteMappingRow(index);
}

function startAddMapping() {
  // 该函数用于新增一条空映射，必须填写完整后才会加入列表。
  pageState.mappingEditIndex = -1;
  fillMappingEditor({ row: "", productName: "", stores: [], materialCodes: [] });
  showMappingEditor();
  setMappingFeedback("正在新增映射，填完后先点“保存这一条”，再点“保存映射”。");
}

function editMappingRow(index) {
  // 该函数用于把选中的映射加载到编辑区。
  pageState.mappingEditIndex = index;
  fillMappingEditor(pageState.mappingRows[index]);
  showMappingEditor();
  setMappingFeedback("正在编辑映射，改完后先点“保存这一条”，再点“保存映射”。");
}

function duplicateMappingRow(index) {
  // 该函数用于复制一条已有映射，方便新增相似产品时少录入内容。
  pageState.mappingEditIndex = -1;
  fillMappingEditor(cloneData(pageState.mappingRows[index]));
  showMappingEditor();
  setMappingFeedback("已复制到编辑区，保存前请确认行号、店铺和料号。");
}

function deleteMappingRow(index) {
  // 该函数用于删除当前弹窗里的映射，最终是否生效取决于是否点击保存映射。
  const productRow = pageState.mappingRows[index];
  if (!window.confirm(`确定删除第${productRow.row}行：${productRow.productName}？`)) return;
  pageState.mappingRows.splice(index, 1);
  hideMappingEditor();
  renderMappingList();
  setMappingFeedback("已从当前列表删除，点击“保存映射”后才会正式生效。");
}

function showMappingEditor() {
  // 该函数用于打开独立编辑弹窗，避免编辑内容夹在映射列表里造成误解。
  const panel = document.getElementById("mappingEditorPanel");
  panel.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  setMappingEditorFeedback("");
  document.getElementById("mappingRowInput").focus();
}

function hideMappingEditor(shouldRestoreFocus = false) {
  // 该函数用于关闭独立编辑弹窗并清理编辑索引，避免下次误覆盖旧行。
  pageState.mappingEditIndex = -1;
  const panel = document.getElementById("mappingEditorPanel");
  panel.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
  document.getElementById("mappingEditIndex").value = "";
  setMappingEditorFeedback("");
  if (document.getElementById("mappingPanel").classList.contains("hidden")) {
    document.body.classList.remove("modal-open");
  }
  if (shouldRestoreFocus && !document.getElementById("mappingPanel").classList.contains("hidden")) {
    document.getElementById("mappingSearchInput").focus();
  }
}

function fillMappingEditor(productRow) {
  // 该函数用于把映射数据填进编辑控件，数组字段用多行文本展示。
  document.getElementById("mappingEditIndex").value = String(pageState.mappingEditIndex);
  document.getElementById("mappingRowInput").value = productRow.row || "";
  document.getElementById("mappingProductNameInput").value = productRow.productName || "";
  document.getElementById("mappingStoresInput").value = (productRow.stores || []).join("\n");
  document.getElementById("mappingMaterialCodesInput").value = (productRow.materialCodes || []).join("\n");
}

function saveMappingEditor() {
  // 该函数用于把编辑区数据保存到当前弹窗列表，避免未校验的数据直接进入本机配置。
  const productRow = readMappingEditor();
  if (!productRow) return;
  if (pageState.mappingEditIndex >= 0) {
    pageState.mappingRows[pageState.mappingEditIndex] = productRow;
  } else {
    pageState.mappingRows.push(productRow);
  }
  pageState.mappingRows = normalizeProductRows(pageState.mappingRows);
  hideMappingEditor(true);
  renderMappingList();
  setMappingFeedback("这一条已更新到当前列表，点击“保存映射”后才会正式生效。");
}

function readMappingEditor() {
  // 该函数用于读取并校验编辑区数据，缺少行号、产品、店铺或料号时直接提示。
  const rowNumber = Number(document.getElementById("mappingRowInput").value);
  const productName = cleanCell(document.getElementById("mappingProductNameInput").value);
  const stores = splitLines(document.getElementById("mappingStoresInput").value);
  const materialCodes = splitLines(document.getElementById("mappingMaterialCodesInput").value);
  if (!Number.isInteger(rowNumber) || rowNumber <= 0) {
    setMappingEditorFeedback("报量表行号必须是大于0的整数。");
    return null;
  }
  if (!productName) {
    setMappingEditorFeedback("产品名称不能为空。");
    return null;
  }
  if (stores.length === 0) {
    setMappingEditorFeedback("店铺名至少填写一行。");
    return null;
  }
  if (materialCodes.length === 0) {
    setMappingEditorFeedback("料号至少填写一行。");
    return null;
  }
  return { row: rowNumber, productName, stores, materialCodes };
}

function cancelMappingEditor() {
  // 该函数用于取消当前编辑，保留列表中已经存在的映射。
  hideMappingEditor(true);
  setMappingFeedback("已取消编辑。");
}

function closeMappingEditorWhenClickOutside(event) {
  // 该函数用于点击遮罩关闭编辑弹窗，保持和其他弹窗一致。
  if (event.target === document.getElementById("mappingEditorPanel")) {
    cancelMappingEditor();
  }
}

function closeMappingEditorWhenPressEscape(event) {
  // 该函数用于按Esc关闭编辑弹窗，避免同时关闭背后的映射列表。
  if (event.key === "Escape" && !document.getElementById("mappingEditorPanel").classList.contains("hidden")) {
    cancelMappingEditor();
  }
}

function setMappingEditorFeedback(message) {
  // 该函数用于在编辑弹窗内显示校验反馈，避免提示被背后的列表挡住。
  document.getElementById("mappingEditorFeedback").textContent = message;
}

function saveMappingConfig() {
  // 该函数用于把当前映射列表正式保存到浏览器本机配置，后续导入会直接使用。
  const config = readConfigForm();
  config.productRows = normalizeProductRows(pageState.mappingRows);
  config.materialCodePreferredProductName = buildMaterialPreferenceIndex(config.productRows);
  saveRuntimeConfigToStorage(config);
  pageState.mappingRows = normalizeProductRows(config.productRows);
  renderMappingList();
  setMappingFeedback(`映射已保存到当前浏览器，共 ${pageState.mappingRows.length} 条。`);
  addStep("映射已保存到当前浏览器", "done");
}

function resetMappingConfig() {
  // 该函数用于单独恢复默认映射，不影响字段名、过滤状态和班次时间配置。
  if (!window.confirm("确定恢复默认映射？字段配置不会被改。")) return;
  const config = readConfigForm();
  config.productRows = normalizeProductRows(window.REPORT_IMPORT_CONFIG.productRows);
  config.materialCodePreferredProductName = buildMaterialPreferenceIndex(config.productRows);
  saveRuntimeConfigToStorage(config);
  pageState.mappingRows = normalizeProductRows(config.productRows);
  hideMappingEditor();
  renderMappingList();
  setMappingFeedback(`已恢复默认映射，共 ${pageState.mappingRows.length} 条。`);
  addStep("映射已恢复默认", "done");
}

function exportMappingConfig() {
  // 该函数用于导出当前映射JSON，方便人工备份或给别人排查问题。
  const productRows = normalizeProductRows(pageState.mappingRows);
  const payload = {
    productRows,
    materialCodePreferredProductName: buildMaterialPreferenceIndex(productRows),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `报量映射-${buildMappingExportTimestamp()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  setMappingFeedback("当前映射已导出为JSON文件。");
}

function buildMappingExportTimestamp() {
  // 该函数用于生成映射备份文件名时间戳，避免覆盖旧备份。
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
}
