function formatBytes(bytes) {
  // 该函数给前端一个可直接展示的内存文本，前端仍保留数字字段用于排序和兜底。
  const normalizedBytes = Math.max(0, Number(bytes) || 0);
  if (normalizedBytes >= 1024 * 1024 * 1024) {
    return `${(normalizedBytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (normalizedBytes >= 1024 * 1024) {
    return `${(normalizedBytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.round(normalizedBytes / 1024)} KB`;
}

module.exports = {
  formatBytes
};
