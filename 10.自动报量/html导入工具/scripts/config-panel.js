// 该文件用于管理导入配置弹窗、字段配置读取和本机保存。
const LOCAL_CONFIG_STORAGE_KEY = "report-import-config-v6-3";

function openConfigView() {
  // 该函数用于打开配置弹窗，避免配置项常驻占用导入页面。
  closeCalendarPopup();
  if (typeof setMappingDialogVisible === "function") setMappingDialogVisible(false);
  setConfigDialogVisible(true);
  setConfigFeedback("");
  document.getElementById("closeConfigButton").focus();
}

function closeConfigView() {
  // 该函数用于关闭配置弹窗并回到导入页面。
  setConfigDialogVisible(false);
  document.getElementById("toggleConfigButton").focus();
}

function setConfigDialogVisible(isVisible) {
  // 该函数用于统一控制配置弹窗显隐，避免多个地方直接改class导致状态不一致。
  const panel = document.getElementById("configPanel");
  panel.classList.toggle("hidden", !isVisible);
  panel.setAttribute("aria-hidden", isVisible ? "false" : "true");
  document.body.classList.toggle("modal-open", isVisible);
  document.getElementById("toggleConfigButton").setAttribute("aria-expanded", isVisible ? "true" : "false");
}

function closeConfigWhenClickOutside(event) {
  // 该函数用于点击遮罩关闭配置弹窗，点击弹窗内容本身不关闭。
  if (event.target === document.getElementById("configPanel")) {
    closeConfigView();
  }
}

function closeConfigWhenPressEscape(event) {
  // 该函数用于按Esc关闭配置弹窗，方便误打开后快速回到导入页面。
  if (event.key === "Escape" && !document.getElementById("configPanel").classList.contains("hidden")) {
    closeConfigView();
  }
}

function setConfigFeedback(message) {
  // 该函数用于在配置弹窗内反馈保存或恢复结果，避免用户不知道按钮有没有生效。
  document.getElementById("configFeedback").textContent = message;
}

function loadConfigForm() {
  // 该函数用于把默认配置或本机保存配置显示到页面上，方便非技术人员修改字段名。
  const storedConfig = readStoredConfig();
  const config = mergeRuntimeConfig(cloneData(window.REPORT_IMPORT_CONFIG), storedConfig);
  for (const input of document.querySelectorAll("[data-config-key]")) {
    input.value = config.sourceColumns[input.dataset.configKey] || "";
  }
  document.getElementById("excludedStatusesInput").value = config.filters.excludedTradeStatuses.join("\n");
  document.getElementById("dayEndInput").value = config.shift.dayEnd;
}

function readStoredConfig() {
  // 该函数用于读取浏览器本机保存的配置，避免客服每次重复改字段。
  const text = localStorage.getItem(LOCAL_CONFIG_STORAGE_KEY);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function mergeRuntimeConfig(baseConfig, storedConfig) {
  // 该函数用于合并默认配置和本机配置，保证字段、过滤、映射都从一个入口生效。
  if (!storedConfig) return baseConfig;
  baseConfig.sourceColumns = { ...baseConfig.sourceColumns, ...(storedConfig.sourceColumns || {}) };
  baseConfig.filters = { ...baseConfig.filters, ...(storedConfig.filters || {}) };
  baseConfig.shift = { ...baseConfig.shift, ...(storedConfig.shift || {}) };
  if (Array.isArray(storedConfig.productRows)) {
    baseConfig.productRows = normalizeProductRows(storedConfig.productRows);
    baseConfig.materialCodePreferredProductName = isPlainObject(storedConfig.materialCodePreferredProductName)
      ? { ...storedConfig.materialCodePreferredProductName }
      : buildMaterialPreferenceIndex(baseConfig.productRows);
  } else if (isPlainObject(storedConfig.materialCodePreferredProductName)) {
    baseConfig.materialCodePreferredProductName = {
      ...baseConfig.materialCodePreferredProductName,
      ...storedConfig.materialCodePreferredProductName,
    };
  }
  return baseConfig;
}

function readConfigForm() {
  // 该函数用于把页面配置转换成计算配置，后续所有字段都从这里统一读取。
  const config = mergeRuntimeConfig(cloneData(window.REPORT_IMPORT_CONFIG), readStoredConfig());
  for (const input of document.querySelectorAll("[data-config-key]")) {
    config.sourceColumns[input.dataset.configKey] = input.value.trim();
  }
  config.filters.excludedTradeStatuses = splitLines(document.getElementById("excludedStatusesInput").value);
  config.shift.dayEnd = document.getElementById("dayEndInput").value || "16:00";
  return config;
}

function saveConfigForm() {
  // 该函数用于把客服改过的字段配置保存到当前浏览器。
  const config = readConfigForm();
  saveRuntimeConfigToStorage(config);
  setConfigFeedback("配置已保存到当前浏览器。");
  addStep("配置已保存到当前浏览器", "done");
}

function resetConfigForm() {
  // 该函数用于恢复字段和过滤默认值，映射由映射弹窗单独恢复，避免误清空。
  const storedConfig = readStoredConfig() || {};
  const defaultConfig = cloneData(window.REPORT_IMPORT_CONFIG);
  const nextConfig = mergeRuntimeConfig(defaultConfig, {
    productRows: storedConfig.productRows,
    materialCodePreferredProductName: storedConfig.materialCodePreferredProductName,
  });
  saveRuntimeConfigToStorage(nextConfig);
  loadConfigForm();
  setConfigFeedback("字段和过滤已恢复默认，映射不变。");
  addStep("字段和过滤已恢复默认", "done");
}

function saveRuntimeConfigToStorage(config) {
  // 该函数用于把所有可配置项统一写入本机存储，避免字段配置和映射配置互相覆盖。
  const productRows = normalizeProductRows(config.productRows || []);
  localStorage.setItem(LOCAL_CONFIG_STORAGE_KEY, JSON.stringify({
    sourceColumns: config.sourceColumns,
    filters: config.filters,
    shift: config.shift,
    productRows,
    materialCodePreferredProductName: buildMaterialPreferenceIndex(productRows),
  }));
}

function normalizeProductRows(productRows) {
  // 该函数用于清洗映射数据，避免空行、空料号或行号文本污染计算入口。
  return (productRows || [])
    .map((productRow) => ({
      row: Number(productRow.row),
      productName: cleanCell(productRow.productName),
      stores: normalizeTextList(productRow.stores),
      materialCodes: normalizeTextList(productRow.materialCodes),
    }))
    .filter((productRow) => (
      Number.isInteger(productRow.row)
      && productRow.row > 0
      && productRow.productName
      && productRow.stores.length > 0
      && productRow.materialCodes.length > 0
    ))
    .sort((left, right) => left.row - right.row || left.productName.localeCompare(right.productName, "zh-CN"));
}

function normalizeTextList(value) {
  // 该函数用于兼容数组和多行文本两种来源，保证映射弹窗保存格式统一。
  if (Array.isArray(value)) return [...new Set(value.map(cleanCell).filter(Boolean))];
  return splitLines(value);
}

function buildMaterialPreferenceIndex(productRows) {
  // 该函数用于为重复料号生成产品优先名，保持历史重复映射时写入结果稳定。
  const index = {};
  for (const productRow of productRows || []) {
    const preferredName = normalizePreferenceProductName(productRow.productName);
    for (const materialCode of productRow.materialCodes || []) {
      if (!index[materialCode]) index[materialCode] = preferredName;
    }
  }
  return index;
}

function normalizePreferenceProductName(productName) {
  // 该函数用于去掉括号价格，避免同一产品改价后重复料号优先匹配失效。
  return cleanCell(productName).replace(/（[^）]*）/g, "").replace(/\s+/g, "");
}

function isPlainObject(value) {
  // 该函数用于判断本机配置里是否真的是普通对象，避免异常值混进合并逻辑。
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
