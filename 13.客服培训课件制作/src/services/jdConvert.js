// 京东原始会话 JSON → 标准聊天记录 转换（纯业务）
// 经验来源：kf.jd.com/chatLog/queryList.action 返回 { chatLogList: [...] }
// 每条会话含 chatLogMessageList[]：{content,created,customer,waiter,waiterSend,type,imgUrl,sid,mid,...}
const { makeChat, windowOfMessages } = require('./chatSchema');

/** 原始返回里挑出会话数组（兼容 data.chatLogList / data 包裹） */
function sessionsOf(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const list = Array.isArray(raw.chatLogList) ? raw.chatLogList
    : raw.data && Array.isArray(raw.data.chatLogList) ? raw.data.chatLogList
    : raw.data && Array.isArray(raw.data) ? raw.data
    : Array.isArray(raw) ? raw : [];
  const objects = list.filter((s) => s && typeof s === 'object');
  if (!objects.some((s) => Array.isArray(s.chatLogMessageList))) return objects;

  // 新版接口返回“每个元素一个消息包”，会话字段在消息的 sid/customer/waiter 中。
  // 先按 sid 聚合，兼容旧版“每个元素就是一个完整会话”的返回格式。
  const grouped = new Map();
  const ungrouped = [];
  for (const row of objects) {
    const messages = Array.isArray(row.chatLogMessageList) ? row.chatLogMessageList : [];
    if (!messages.length) {
      ungrouped.push(row);
      continue;
    }
    for (const message of messages) {
      const sid = message && message.sid != null ? String(message.sid) : (row.sid != null ? String(row.sid) : '');
      if (!sid) {
        ungrouped.push({ ...row, chatLogMessageList: [message] });
        continue;
      }
      if (!grouped.has(sid)) {
        grouped.set(sid, {
          sid,
          customer: message.customer || row.customer || '',
          waiter: message.waiter || row.waiter || '',
          closeTypeDesc: message.closeTypeDesc || row.closeTypeDesc || '',
          chatLogMessageList: []
        });
      }
      grouped.get(sid).chatLogMessageList.push(message);
    }
  }
  return [...grouped.values(), ...ungrouped];
}

function messageCountOf(session) {
  return Array.isArray(session.chatLogMessageList) ? session.chatLogMessageList.length : 0;
}

function firstLineOf(session) {
  const list = Array.isArray(session.chatLogMessageList) ? session.chatLogMessageList : [];
  for (const m of list) {
    if (m && m.content && !m.imgUrl) {
      const t = String(m.content).replace(/<br\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 40);
    }
  }
  return '';
}

/** 会话摘要列表（供界面展示与选择） */
function summarizeSessions(raw) {
  return sessionsOf(raw).map((s) => {
    const list = Array.isArray(s.chatLogMessageList) ? s.chatLogMessageList : [];
    const times = list.map((m) => m.created || '').filter(Boolean).sort();
    return {
      sid: s.sid != null ? String(s.sid) : '',
      customer: s.customer || '',
      waiter: s.waiter || '',
      firstTime: times[0] || '',
      lastTime: times[times.length - 1] || '',
      messageCount: list.length,
      headline: firstLineOf(s),
      closeTypeDesc: s.closeTypeDesc || ''
    };
  }).sort((a, b) => String(b.firstTime).localeCompare(String(a.firstTime)));
}

/** 选一条会话转标准聊天记录；sid 缺省取消息最多的一条 */
function rawSessionToChat(raw, { sid, meta = {} } = {}) {
  const sessions = sessionsOf(raw);
  if (sessions.length === 0) throw new Error('返回数据里没有任何会话（chatLogList 为空）');
  let session = sessions.find((s) => s.sid != null && String(s.sid) === String(sid));
  if (!session) {
    if (sid !== undefined && sid !== null && sid !== '') {
      throw new Error(`未找到会话 sid=${sid}，可能为跨会话或多页返回`);
    }
    session = sessions.reduce((best, s) => (messageCountOf(s) > messageCountOf(best) ? s : best), sessions[0]);
  }
  const list = (session.chatLogMessageList || [])
    .map((m) => ({
      time: m.created || '',
      role: Number(m.waiterSend) === 1 ? 'waiter' : 'customer',
      text: m.content != null ? String(m.content) : '',
      img: m.imgUrl || '',
      type: m.type || 'text'
    }))
    .filter((m) => m.text !== '' || m.img !== '')
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));

  const window = meta.window || windowOfMessages(list);
  return makeChat({
    platform: 'jd',
    meta: {
      customer: session.customer || meta.customer || '',
      window,
      store: meta.store || '',
      sourceNote: `京东会话 sid=${session.sid || ''}（waiter=${session.waiter || ''}）`,
      rawSid: session.sid != null ? String(session.sid) : ''
    },
    messages: list
  });
}

module.exports = { sessionsOf, summarizeSessions, rawSessionToChat, messageCountOf };
