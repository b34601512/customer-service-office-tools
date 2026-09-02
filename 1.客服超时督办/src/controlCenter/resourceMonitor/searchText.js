function normalizeSearchText(value) {
  // Windows 命令行路径有时混用斜杠，这里统一格式后再判断是否属于本项目。
  return String(value || "").replace(/\//g, "\\").toLowerCase();
}

module.exports = {
  normalizeSearchText
};
