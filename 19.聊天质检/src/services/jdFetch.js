// 京东聊天记录抓取（纯业务）：连接 Chrome 调试端口，在 kf.jd.com 页面内 fetch queryList.action
// 复用已登录的京东后台会话；不负责界面，调用方负责展示/选择会话。
const { summarizeSessions, rawSessionToChat } = require('./jdConvert');

// 本机 CDP 请求必须绕过代理，否则代理可能把 127.0.0.1 改写成网关请求。
process.env.NO_PROXY = [process.env.NO_PROXY, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;

async function httpGetJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 列出调试端口上的页面（type=page） */
async function listPages({ port = 9222, timeoutMs = 5000 } = {}) {
  const meta = await httpGetJson(`http://127.0.0.1:${port}/json/list`, timeoutMs).catch((e) => {
    throw new Error(`连不上浏览器调试端口 ${port}（${e.message}）。请先运行 browser:start，并在独立浏览器中登录京东后台。`);
  });
  return (Array.isArray(meta) ? meta : [])
    .filter((t) => t.type === 'page')
    .filter((t) => !/^(about|edge|chrome|chrome-extension):/i.test(String(t.url || '')));
}

/** 候选匹配：优先标题包含配置词，其次 URL 含 kf.jd.com */
function matchPageScore(page, titleMatch) {
  let score = 0;
  const title = String(page.title || '');
  const url = String(page.url || '');
  if (titleMatch && title.includes(titleMatch)) score += 10;
  if (url.includes('kf.jd.com')) score += 5;
  // 实际登录后的客服后台常停在 shop.jd.com/jdm/kefu/*，标题通常只是“京麦”。
  if (/shop\.jd\.com\/jdm\/kefu(?:\/|$)/i.test(url)) score += 5;
  return score;
}

function pickCandidates(pages, titleMatch) {
  return pages
    .map((p) => ({ page: p, score: matchPageScore(p, titleMatch) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** 在指定页面上下文执行 JS 表达式（awaitPromise），返回 byValue 结果。
 * 超时或调试连接关闭必须显式 reject——历史上 ws.close() 后 pending Promise 永不 settle，
 * 事件循环排空导致进程静默退出 0（无输出无报错），违反「禁止静默等待」铁律。 */
async function evaluateOnPage(page, expression, { timeoutMs = 60000, createSocket } = {}) {
  const connect = createSocket || ((url) => new WebSocket(url));
  const ws = connect(page.webSocketDebuggerUrl);
  let timer = null;
  try {
    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => { if (!settled) { settled = true; fn(value); } };
      timer = setTimeout(() => {
        // 先 settle 再 close：若 close 同步派发 close 事件，避免错误信息被“连接被关闭”覆盖
        settle(reject, new Error(`页面执行超时（>${timeoutMs}ms）：页内脚本没有返回。`
          + '常见原因是浏览器窗口最小化或标签页在后台被浏览器节流，页内 JS 被冻结不执行；'
          + '请把浏览器窗口还原并置于前台后重试。'));
        try { ws.close(); } catch { /* 关闭失败不影响报错 */ }
      }, timeoutMs);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }
        }));
      });
      ws.addEventListener('error', () => settle(reject, new Error('调试连接错误，无法在页面内执行脚本')));
      ws.addEventListener('close', () => settle(reject, new Error('调试连接在返回结果前被关闭')));
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id !== 1) return;
        if (msg.error) settle(reject, new Error(msg.error.message));
        else if (msg.result && msg.result.exceptionDetails) {
          settle(reject, new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text));
        } else settle(resolve, msg.result);
      });
    });
    return result.result?.value;
  } finally {
    if (timer) clearTimeout(timer);
    try { ws.close(); } catch { /* 已关闭 */ }
  }
}

function buildQueryUrl(apiBase, { customer = '', startTime = '', endTime = '', page = 1, pageSize = 50 } = {}) {
  const sep = String(apiBase).includes('?') ? '&' : '?';
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (customer) params.set('customer', customer);
  if (startTime) params.set('startTime', startTime);
  if (endTime) params.set('endTime', endTime);
  return `${apiBase}${sep}${params.toString()}`;
}

/** 构造在页面内执行的 fetch 表达式（页面需为 kf.jd.com，同源带 Cookie） */
function buildFetchExpression(apiBase, params) {
  const url = buildQueryUrl(apiBase, params);
  return `(async () => {
    const url = ${JSON.stringify(url)};
    try {
      const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) { /* 非 JSON 返回 */ }
      return { status: res.status, ok: res.ok, data, text: (data ? '' : text).slice(0, 300), url };
    } catch (e) {
      return { status: 0, ok: false, error: String(e && e.message || e), url };
    }
  })()`;
}

/** 抓取会话原始返回（自动处理最多 maxPages 页，返回全部会话原始对象） */
async function fetchChatLogRaw({ pageInfo, apiBase, query, pageSize = 50, maxPages = 5 } = {}) {
  const page = pageInfo;
  if (!page || !page.webSocketDebuggerUrl) throw new Error('缺少目标页面信息');
  const pageUrl = String(page.url || '');
  const pageTitle = String(page.title || '');
  if (!pageUrl.includes('kf.jd.com')
      && !/shop\.jd\.com\/jdm\/kefu(?:\/|$)/i.test(pageUrl)
      && !pageTitle.includes('京东')
      && !pageTitle.includes('京麦')) {
    // 仅在页面明显不相关时报错（避免误点别的网页执行带 Cookie 请求）
    throw new Error(`目标页面似乎不是京东客服管家页面：${page.title} / ${page.url}`);
  }
  const list = [];
  const results = [];
  for (let p = 1; p <= maxPages; p += 1) {
    const params = { ...query, page: p, pageSize };
    const expr = buildFetchExpression(apiBase, params);
    const out = await evaluateOnPage(page, expr);
    if (!out) throw new Error('页面执行无返回');
    if (!out.ok) throw new Error(`京东接口返回 ${out.status || '失败'}：${out.error || out.text || ''}`);
    if (!out.data) throw new Error(`京东接口非 JSON：${out.text || ''}`);
    results.push(out.data);
    const sessions = out.data && (Array.isArray(out.data.chatLogList) ? out.data.chatLogList
      : Array.isArray(out.data) ? out.data : []);
    list.push(...sessions);
    if (!sessions || sessions.length < pageSize) break;
  }
  return { pages: results, sessions: list, summary: summarizeSessions({ chatLogList: list }) };
}

async function fetchJdSummaryAndChat({ pageInfo, apiBase, query, pageSize = 50, maxPages = 5 }) {
  const fetched = await fetchChatLogRaw({ pageInfo, apiBase, query, pageSize, maxPages });
  return {
    ...fetched,
    toChat: (sid) => rawSessionToChat({ chatLogList: fetched.sessions }, { sid, meta: { window: query.startTime } })
  };
}

module.exports = {
  listPages, pickCandidates, evaluateOnPage, buildQueryUrl, buildFetchExpression,
  fetchChatLogRaw, fetchJdSummaryAndChat
};
