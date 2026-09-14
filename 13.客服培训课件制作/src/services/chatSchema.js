// 标准聊天记录格式（纯业务）：
// {
//   format: 'chat-record/1',
//   platform: 'jd' | 'manual',
//   meta: { customer, orderId, window, store, sourceNote },
//   messages: [ { time:'YYYY-MM-DD HH:MM:SS', role:'customer'|'waiter'|'system', text, img?, label? } ]
// }
// role='system' 是机器人自动回复/欢迎语/商品卡片等无人值守消息，label 存来源（如“自动回复”）。
// 为什么必须有这个角色：京东旧接口不含机器人消息，丢了它们会把“机器人已答、客服只发了个表情”误判成客服不答问题。
const FORMAT = 'chat-record/1';
const ROLES = ['customer', 'waiter', 'system'];

function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 京东 chatLog 原始字段映射
  const time = raw.time || raw.created || '';
  let role = raw.role;
  if (!role && raw.waiterSend !== undefined) role = Number(raw.waiterSend) === 1 ? 'waiter' : 'customer';
  if (role === '客户' || role === '买家') role = 'customer';
  if (role === '客服' || role === '商家') role = 'waiter';
  if (role === '系统' || role === '机器人' || role === '自动回复') role = 'system';
  if (!ROLES.includes(role)) role = 'customer';
  const text = raw.text != null ? String(raw.text) : (raw.content != null ? String(raw.content) : '');
  const msg = { time: String(time || ''), role, text };
  if (raw.label) msg.label = String(raw.label);
  if (raw.img || raw.imgUrl) msg.img = String(raw.img || raw.imgUrl);
  return msg;
}

function windowOfMessages(messages) {
  for (const m of messages) {
    const d = String(m.time || '').match(/^\s*(\d{4}-\d{2}-\d{2})/);
    if (d) return d[1];
  }
  return '';
}

function validateChat(chat, { requireMessages = true } = {}) {
  const errors = [];
  if (!chat || typeof chat !== 'object') return { ok: false, errors: ['聊天记录不是对象'] };
  if (chat.format && chat.format !== FORMAT) errors.push(`format 不是 ${FORMAT}: ${chat.format}`);
  if (!Array.isArray(chat.messages)) errors.push('messages 必须是数组');
  if (chat.messages) {
    chat.messages.forEach((m, i) => {
      if (!m || !ROLES.includes(m.role)) errors.push(`消息[${i}] role 必须为 customer/waiter/system`);
      if (typeof m.text !== 'string') errors.push(`消息[${i}] text 必须是字符串`);
      if (!m.time) errors.push(`消息[${i}] 缺少 time`);
    });
  }
  if (requireMessages && (!chat.messages || chat.messages.length === 0)) errors.push('聊天记录没有任何消息');
  return { ok: errors.length === 0, errors };
}

/** 组装标准聊天记录（供各来源转换后调用） */
function makeChat({ platform = 'manual', meta = {}, messages = [] }) {
  const clean = messages.map(normalizeMessage).filter(Boolean);
  const window = meta.window || windowOfMessages(clean);
  return {
    format: FORMAT,
    platform,
    meta: { customer: '', orderId: '', window, store: '', tag: '', sourceNote: '', ...meta, window },
    messages: clean
  };
}

module.exports = { FORMAT, ROLES, normalizeMessage, validateChat, makeChat, windowOfMessages };
