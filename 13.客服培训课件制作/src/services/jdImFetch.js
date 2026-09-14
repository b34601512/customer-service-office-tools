// 京东咚咚 IM「全量」聊天记录抓取（纯业务）：**含机器人自动回复 / 欢迎语 / 商品卡片**。
//
// 背景（2026-09-14 踩坑，勿删）：kf.jd.com 的 chatLog/queryList.action、waiterSession/queryChatLog
// 只返回客服与客户的消息，**不含**机器人自动回复。会话行「查看」面板的“该用户全部聊天记录”
// 才是全量，数据来自 api.m.jd.com/client.action?functionId=queryLastLogs（带 h5st 签名，
// 只能由页面自己发请求），所以这里用 CDP 驱动页面 UI（填顾客ID→查询→查看）并监听网络把响应抓回来。
// 只看旧口径会把“机器人已答完、客服只发了个表情打招呼”误判成“客服不答问题”，误伤客服。
const { normalizeEmojiCodes } = require('./jdConvert');
const { makeChat, windowOfMessages } = require('./chatSchema');

const BOT_PIN = '@im.jd.com';
const CN_OFFSET_MS = 8 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CDP 小工具 ----------
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 打开失败')), { once: true });
  });
}

function send(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const on = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', on);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, id, expression) {
  const r = await send(ws, id, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面执行失败');
  return r && r.result ? r.result.value : undefined;
}

function setCustomerExpr(pin) {
  return `(() => {
    const input = [...document.querySelectorAll('input')].find((x) => (x.placeholder || '').includes('顾客ID'));
    if (!input) return 'NO_INPUT';
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(pin)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '查询');
    if (!btn) return 'NO_QUERY_BTN';
    btn.click();
    return 'ok';
  })()`;
}

function clickViewExpr(pin) {
  return `(() => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find((r) => (r.innerText || '').includes(${JSON.stringify(pin)}));
    if (!row) return 'NO_ROW';
    const link = [...row.querySelectorAll('a')].find((x) => (x.innerText || '').trim() === '查看');
    if (!link) return 'NO_VIEW_LINK';
    link.click();
    return 'ok';
  })()`;
}

/** 刷新页面并等到查询表单出现（重复点“查看”时页面不会重新发请求，只能刷新重置状态） */
async function reloadAndWait(ws) {
  await send(ws, 20, 'Page.enable', {});
  await send(ws, 21, 'Page.reload', {});
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const ready = await evaluate(ws, 22, "(() => [...document.querySelectorAll('input')].some((x) => (x.placeholder || '').includes('顾客ID')))()").catch(() => false);
    if (ready) return true;
  }
  return false;
}

/** 抓取该顾客的咚咚全量聊天记录（原始 IM 消息数组，倒序）。失败抛出可读错误。 */
async function fetchImFullLog({ pageInfo, customerPin, timeoutMs = 30000 } = {}) {
  if (!pageInfo || !pageInfo.webSocketDebuggerUrl) throw new Error('缺少目标页面信息');
  if (!customerPin) throw new Error('缺少顾客ID');
  const ws = await wsConnect(pageInfo.webSocketDebuggerUrl);
  const captured = [];
  const onMessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method !== 'Network.responseReceived') return;
    const url = String(m.params.response.url || '');
    if (!/api\.m\.jd\.com\/client\.action/.test(url) || !/queryLastLogs/.test(url)) return;
    send(ws, 900 + captured.length, 'Network.getResponseBody', { requestId: m.params.requestId })
      .then((body) => {
        if (!body || !body.body || body.body.length < 200) return;
        try { captured.push(JSON.parse(body.body)); } catch { /* 非 JSON 忽略 */ }
      })
      .catch(() => {});
  };
  ws.addEventListener('message', onMessage);

  const attempt = async (before) => {
    if (before) await before();
    const set = await evaluate(ws, 2, setCustomerExpr(customerPin));
    if (set !== 'ok') throw new Error(`页面上没找到顾客ID输入框/查询按钮（${set}）`);
    await sleep(5000);
    const clicked = await evaluate(ws, 3, clickViewExpr(customerPin));
    if (clicked !== 'ok') throw new Error(`没找到「${customerPin}」的会话行或「查看」链接（${clicked}）`);
    const deadline = Date.now() + timeoutMs;
    while (captured.length === 0 && Date.now() < deadline) await sleep(500);
  };

  try {
    await send(ws, 1, 'Network.enable', {});
    await attempt(null);
    if (captured.length === 0) {
      // 面板已经打开过时不会再发请求，刷新页面后重试一次
      await attempt(() => reloadAndWait(ws));
    }
    if (captured.length === 0) throw new Error('没有抓取到 queryLastLogs 响应（检查是否已登录该店铺 / 页面是否为聊天记录页）');
    return captured[captured.length - 1];
  } finally {
    ws.removeEventListener('message', onMessage);
    try { ws.close(); } catch { /* ignore */ }
  }
}

// ---------- 转换：咚咚原始消息 → 标准聊天记录 ----------
function formatCnTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n + CN_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

function stripHtml(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&amp;/gi, '&');
}

/** 消息文本：普通消息取 content；模板卡片（欢迎语/商品卡片）从 tplData 里拼标题与正文 */
function textOf(body) {
  const b = body || {};
  const parts = [];
  const tpl = b.data && b.data.tplData;
  const items = tpl && Array.isArray(tpl.data) ? tpl.data : [];
  for (const item of items) {
    const d = item && item.data;
    if (!d) continue;
    if (typeof d.title === 'string' && d.title.trim()) parts.push(d.title);
    if (typeof d.content === 'string' && d.content.trim()) parts.push(d.content);
    if (typeof d.pushContent === 'string' && d.pushContent.trim()) parts.push(d.pushContent);
  }
  let raw = parts.length ? parts.join('\n') : String(b.content || b.pushContent || '');
  if (!raw && tpl && typeof tpl.pushContent === 'string') raw = tpl.pushContent;
  return normalizeEmojiCodes(
    stripHtml(raw).split('\n').map((l) => l.trim()).filter(Boolean).join('\n').trim()
  );
}

/** 是否模板卡片（欢迎语/商品卡片等系统推送） */
function isTemplate(body) {
  const b = body || {};
  return String(b.type || '') === 'template2' || !!(b.data && b.data.tplData);
}

/** 是否智能客服自动应答（含以店铺账号名义发出的菜单答案，如 action.code=cfg.welcome.new） */
function isAutoAnswer(body) {
  const b = body || {};
  if (b.action && b.action.code) return true;
  const cb = b.chatinfo && b.chatinfo.cbData;
  return !!(cb && (cb.optionValue || cb.default));
}

function templateLabel(pin, body) {
  const b = body || {};
  const text = `${(b.chatinfo && b.chatinfo.pushContent) || ''}${textOf(b)}`;
  if (/^jimi_vender/i.test(pin)) return '商品卡片';
  if (text.includes('欢迎')) return '欢迎语';
  return '系统消息';
}

/** 判定一条 IM 消息的角色：customer / waiter / system(含 label) */
function classifyMessage(msg) {
  const from = (msg && msg.from) || {};
  const body = (msg && msg.body) || {};
  const pin = String(from.pin || '');
  if (String(from.app || '') === 'im.customer') return { role: 'customer', label: '' };
  if (pin === BOT_PIN || isAutoAnswer(body)) return { role: 'system', label: '自动回复' };
  if (isTemplate(body)) return { role: 'system', label: templateLabel(pin, body) };
  if (!pin) return { role: 'system', label: '系统消息' };
  return { role: 'waiter', label: '' };
}

/** 咚咚原始响应 → 扁平消息数组（按时间正序） */
function imMessagesOf(raw) {
  const list = raw && Array.isArray(raw.data) ? raw.data : [];
  return list
    .map((m) => {
      if (!m || typeof m !== 'object') return null;
      const body = m.body || {};
      const c = classifyMessage(m);
      const chat = body.chatinfo || {};
      const img = String(body.type || '') === 'image' ? String(body.url || '') : '';
      const message = {
        time: formatCnTime(m.datetime || m.clientTime || m.timestamp) || String(m.datetime || ''),
        role: c.role,
        text: textOf(body),
        sid: String(chat.sid || body.sid || '')
      };
      if (c.label) message.label = c.label;
      if (img) message.img = img;
      return message;
    })
    .filter((m) => m && (m.text || m.img))
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

/** 把没有 sid 的系统消息挂到时间最近的会话上（欢迎语/商品卡片没有 sid） */
function nearestSidOf(msgTime, sessions) {
  let best = '';
  let bestGap = Infinity;
  for (const s of sessions) {
    for (const t of s.times) {
      const gap = Math.abs(new Date(`${t.replace(' ', 'T')}Z`).getTime() - new Date(`${msgTime.replace(' ', 'T')}Z`).getTime());
      if (gap < bestGap) { bestGap = gap; best = s.sid; }
    }
  }
  return best;
}

/**
 * 按会话（sid）分组。返回 [{ sid, messages:[...] }]，messages 按时间正序，
 * 系统消息（欢迎语/商品卡片/自动回复）按时间就近归属到会话里。
 */
function imSessionsOf(raw) {
  const messages = imMessagesOf(raw);
  const groups = new Map();
  for (const m of messages) {
    if (!m.sid) continue;
    if (!groups.has(m.sid)) groups.set(m.sid, []);
    groups.get(m.sid).push(m);
  }
  const sessions = [...groups.entries()].map(([sid, msgs]) => ({
    sid,
    times: msgs.map((m) => m.time).filter(Boolean),
    messages: [...msgs]
  }));
  for (const m of messages) {
    if (m.sid) continue;
    const sid = nearestSidOf(m.time, sessions);
    const target = sessions.find((s) => s.sid === sid);
    if (target) {
      target.messages.push(m);
      target.times.push(m.time);
    }
  }
  return sessions
    .map((s) => ({
      sid: s.sid,
      messages: s.messages.sort((a, b) => String(a.time).localeCompare(String(b.time)))
    }))
    .sort((a, b) => String(a.messages[0] && a.messages[0].time).localeCompare(String(b.messages[0] && b.messages[0].time)));
}

/** 一条 IM 会话 → 标准聊天记录（含机器人/系统消息；tag 用于同一顾客多个会话区分文件名） */
function imSessionToChat(session, { customerPin = '', tag = '', store = '', window = '' } = {}) {
  const messages = (session.messages || []).map((m) => {
    const out = { time: m.time, role: m.role, text: m.text };
    if (m.label) out.label = m.label;
    if (m.img) out.img = m.img;
    return out;
  });
  const customer = customerPin;
  return makeChat({
    platform: 'jd',
    meta: {
      customer,
      tag,
      window: window || windowOfMessages(messages),
      store,
      sourceNote: `京东咚咚全量记录 sid=${session.sid}（含机器人自动回复/系统消息）`,
      rawSid: session.sid
    },
    messages
  });
}

/** 会话摘要（供命令行展示选择） */
function summarizeImSessions(raw) {
  return imSessionsOf(raw).map((s) => {
    const auto = s.messages.filter((m) => m.role === 'system' && m.label === '自动回复').length;
    const system = s.messages.filter((m) => m.role === 'system').length;
    return {
      sid: s.sid,
      messageCount: s.messages.length,
      firstTime: (s.messages[0] || {}).time || '',
      lastTime: (s.messages[s.messages.length - 1] || {}).time || '',
      autoCount: auto,
      systemCount: system,
      waiterCount: s.messages.filter((m) => m.role === 'waiter').length,
      customerCount: s.messages.filter((m) => m.role === 'customer').length
    };
  });
}

module.exports = {
  fetchImFullLog, imMessagesOf, imSessionsOf, imSessionToChat, summarizeImSessions,
  classifyMessage, formatCnTime, BOT_PIN
};
