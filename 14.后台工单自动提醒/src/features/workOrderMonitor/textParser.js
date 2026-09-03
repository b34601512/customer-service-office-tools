// 本文件是纯函数解析层：从页面文本提取页签计数、表格单号/判责，识别登录跳转，不依赖浏览器。
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

// POP 纠纷页签→tabCode（#623 实测）：深读行时直接改 URL 参数，比点击稳。
const POP_TAB_CODES = {
  全部: "ALL",
  京东介入: "JD_TAKE_PART",
  待回复: "WAIT_REPLY",
  待处理: "WAIT_EVIDENCE",
  和解中: "PEACE",
  待执行: "WAIT_EXECUTE",
  可申诉: "CAN_APPEAL",
  已申诉: "APPEAL"
};

function buildTabUrl(url, label) {
  const code = POP_TAB_CODES[label];
  if (!code) return null;
  return String(url).replace(/([?&])tabCode=[^&]*/, `$1tabCode=${code}`);
}

// 判责已出短语集（纠纷页“判责结果”列实测“商家已和解”+京东常见取值）；命中=已出只提醒一次，未命中=暂无重复提醒。
const VERDICT_DECIDED = /买家责任|商家责任|双方责任|物流责任|平台承担|已和解|维持原判|支持买家|支持商家/;
const VERDICT_TEXT = /(买家责任|商家责任|双方责任|物流责任|平台承担|商家已和解|买家已和解|已和解|维持原判|支持买家|支持商家)/;

// 行文本列表 → 工单列表。id 只用编号（行内含“还剩X天”倒计时，全文做 id 会假新增）。
function parseTicketRows(rowTexts) {
  const tickets = [];
  const seen = new Set();
  for (const text of rowTexts || []) {
    const t = String(text || "").trim();
    if (t.length < 12) continue;
    if (/^[A-Za-z]?[\d\s]{6,}$/.test(t)) continue; // 日历块、控件码等纯数字/字母数字块（实测 C20170418100026 会误入）
    // 真数据行必带操作按钮；京东客服电话 4006229068 这类悬浮块无按钮，实测会假新单（#631）。
    if (!/查看详情|去申诉|去举证|去处理|去回复|催处理/.test(t)) continue;
    const longNums = t.match(/\d{12,19}/g) || []; // 订单编号
    const shortNums = t.match(/(?<![\dA-Za-z])\d{7,10}(?![\d])/g) || []; // 纠纷单/工单编号
    const orderId = longNums[0] || "";
    const ticketId = shortNums[0] || "";
    const id = ticketId || orderId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const decided = VERDICT_DECIDED.test(t);
    const vm = t.match(VERDICT_TEXT);
    tickets.push({ id, ticketId, orderId, decided, verdict: decided && vm ? vm[1] : "" });
  }
  return tickets;
}

module.exports = { parseCounts, isLoginRedirect, looksLikeBrokenPage, parseTicketRows, buildTabUrl, POP_TAB_CODES };
