// 京东聊天记录抓取（纯业务）：连接 Chrome 调试端口，在 kf.jd.com 页面内 fetch queryList.action
// 复用已登录的京东后台会话；不负责界面，调用方负责展示/选择会话。
const { summarizeSessions, rawSessionToChat } = require('./jdConvert');

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
    throw new Error(`连不上 Chrome 调试端口 ${port}（${e.message}）。请确认已用 --remote-debugging-port=${port} 启动 Chrome 并登录京东后台。`);
  });
  return (Array.isArray(meta) ? meta : []).filter((t) => t.type === 'page');
}

/** 候选匹配：优先标题包含配置词，其次 URL 含 kf.jd.com */
function matchPageScore(page, titleMatch) {
  let score = 0;
  if (titleMatch && String(page.title || '').includes(titleMatch)) score += 10;
  if (String(page.url || '').includes('kf.jd.com')) score += 5;
  return score;
}

function pickCandidates(pages, titleMatch) {
  return pages
    .map((p) => ({ page: p, score: matchPageScore(p, titleMatch) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** 在指定页面上下文执行 JS 表达式（awaitPromise），返回 byValue 结果 */
async function evaluateOnPage(page, expression, { timeoutMs = 60000 } = {}) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 打开失败')), { once: true });
  });
  const timer = setTimeout(() => ws.close(), timeoutMs);
  try {
    const result = await new Promise((resolve, reject) => {
      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.id !== 1) return;
        if (msg.error) reject(new Error(msg.error.message));
        else if (msg.result && msg.result.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text));
        } else resolve(msg.result);
      });
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs }
      }));
    });
    return result.result?.value;
  } finally {
    clearTimeout(timer);
    ws.close();
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
  if (!String(page.url || '').includes('kf.jd.com') && !String(page.title || '').includes('京东')) {
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
