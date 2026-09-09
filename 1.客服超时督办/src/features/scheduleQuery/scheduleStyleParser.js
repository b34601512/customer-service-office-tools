// 该文件用于解析排班表单元格的有效背景色，值班标记不再依赖班次文字猜测。
function normalizeBackgroundColor(value) {
  // 这里兼容 KDocs 返回的 RGB 整数和常见十六进制文本，统一成可审计的 #RRGGBB。
  if (typeof value === "number" && Number.isFinite(value)) {
    return `#${(value >>> 0 & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
  }

  const text = String(value || "").trim().toUpperCase();
  if (!text) {
    return "";
  }

  const hexMatch = text.match(/^#?([0-9A-F]{6})$/);
  if (hexMatch) {
    return `#${hexMatch[1]}`;
  }

  const rgbMatch = text.match(/^RGB\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const channels = rgbMatch.slice(1).map(Number);
    if (channels.every((channel) => channel >= 0 && channel <= 255)) {
      return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
    }
  }

  return "";
}

function isMarkedBackgroundColor(value) {
  // 这里把无填充、白色填充和透明占位都视为“未标记”；其余有效颜色才算值班标记。
  const normalizedColor = normalizeBackgroundColor(value);
  return Boolean(normalizedColor && normalizedColor !== "#FFFFFF");
}

module.exports = {
  isMarkedBackgroundColor,
  normalizeBackgroundColor
};
