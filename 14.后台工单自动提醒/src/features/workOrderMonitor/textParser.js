// 本文件是纯函数解析层：从页面文本提取页签计数、识别登录跳转，不依赖浏览器。
// 依据 #623 采集：京喜工单页文本形如「待处理(0)全部 平台协同工单 (0)物流投诉工单 (0)…」，
// POP纠纷页形如「全部(1313) 京东介入(0) 待回复(0) 待处理(0)…」。

function parseCounts(pageText, watchLabels) {
  const counts = {};
  for (const label of watchLabels) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(escaped + "\\s*[（(]\\s*(\\d+)\\s*[）)]").exec(pageText);
    if (match) {
      counts[label] = Number(match[1]);
    }
  }
  return counts;
}

function isLoginRedirect(url) {
  return /passport\.(shop\.)?jd\.com\/login/i.test(String(url || ""));
}

// 页面文本里出现这些词说明脚本没渲染出目标区块（不算登录失效，算页面异常）。
function looksLikeBrokenPage(pageText, watchLabels) {
  const text = String(pageText || "");
  return text.length < 200 && !watchLabels.some((label) => text.includes(label));
}

module.exports = { parseCounts, isLoginRedirect, looksLikeBrokenPage };
