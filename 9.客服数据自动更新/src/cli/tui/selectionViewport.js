// 配置列表共用的滚动窗口：保留标题、当前选中行和末尾提示。
function selectionViewport(lines, selectedLine, height, headerCount = 1, footerCount = 0) {
  if (!Number.isFinite(height) || lines.length <= height) return lines;
  const available = Math.max(1, height - headerCount - footerCount);
  const end = lines.length - footerCount;
  const start = Math.max(headerCount, Math.min(selectedLine - available + 1, end - available));
  return [
    ...lines.slice(0, headerCount),
    ...lines.slice(start, start + available),
    ...(footerCount ? lines.slice(-footerCount) : [])
  ];
}

module.exports = { selectionViewport };
