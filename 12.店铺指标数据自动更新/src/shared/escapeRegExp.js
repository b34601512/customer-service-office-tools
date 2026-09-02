// 该文件只提供正则元字符转义的唯一实现，供页面文本匹配与弹窗文案匹配共用。
function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  escapeRegExp
};
