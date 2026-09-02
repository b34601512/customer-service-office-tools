// 该文件用于解决天猫日期面板 DOM 选择器生成问题。
function assertTmallPanelClassName(panelClassName) {
  // 这里限制面板类名只能是安全字符，避免把动态值拼进 CSS 选择器造成误选。
  const normalizedPanelClassName = String(panelClassName || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalizedPanelClassName)) {
    throw new Error(`天猫日期面板类名不合法：${normalizedPanelClassName || "空"}`);
  }
  return normalizedPanelClassName;
}

function assertTmallDateText(dateText) {
  // 这里只允许标准日期进入 DOM 选择器，防止异常配置污染页面脚本。
  const normalizedDateText = String(dateText || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateText)) {
    throw new Error(`天猫日期格式不合法：${normalizedDateText || "空"}`);
  }
  return normalizedDateText;
}

function buildTmallDateCellSelector(panelClassName, dateText) {
  // 这里生成目标日期单元格选择器，新路线只按 data-value 精准选日期。
  const safePanelClassName = assertTmallPanelClassName(panelClassName);
  const safeDateText = assertTmallDateText(dateText);
  return `.${safePanelClassName} td[data-role="date"][data-value="${safeDateText}"]:not(.disabled-element)`;
}

module.exports = {
  assertTmallDateText,
  buildTmallDateCellSelector
};
