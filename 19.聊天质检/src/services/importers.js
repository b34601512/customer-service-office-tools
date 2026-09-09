// 手动导入（纯业务）：粘贴文本 / 文件 → 标准聊天记录
// 支持的来源：
//   1) 人类友好文本：每行  时间|客服|内容  或  时间|客户|内容
//      分隔符支持 | 或 ｜；角色只认 客服/客户；时间 YYYY-MM-DD HH:MM(:SS) 可省略秒，
//      允许整行以 # 或 // 开头作注释。
//   2) 京东原始 JSON（含 chatLogList）→ 自动取消息最多的会话。
//   3) 标准聊天记录 JSON（chat-record/1）→ 校验后原样使用。
const fs = require('fs');
const path = require('path');
const { makeChat, validateChat, normalizeMessage } = require('./chatSchema');
const { rawSessionToChat } = require('./jdConvert');

const LINE_RE = /^\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?|\d{2}:\d{2}(?::\d{2})?)?\s*[|｜]\s*(客服|客户)\s*[|｜]\s*(.+)$/;

/** 解析粘贴文本。返回 { messages, errors }；errors 是格式不对的行号。 */
function parseImportText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const messages = [];
  const errors = [];
  let lastTime = '';
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('#') || line.startsWith('//')) return;
    const m = LINE_RE.exec(line);
    if (!m) {
      errors.push(`第 ${lineNo} 行格式不对：${line.slice(0, 50)}`);
      return;
    }
    const [, timeRaw, roleText, content] = m;
    let time;
    if (!timeRaw) {
      time = lastTime; // 整行无时间 → 复用上一条时间
    } else if (/^\d{2}:\d{2}/.test(timeRaw)) {
      // 仅时分 → 复用上一条的日期
      const date = (lastTime || '').match(/^(\d{4}-\d{2}-\d{2})/);
      time = date ? `${date[1]} ${timeRaw}` : timeRaw;
    } else {
      time = String(timeRaw).replace('T', ' ');
    }
    const contentClean = content.replace(/<br\/?>/gi, ' ');
    if (contentClean.trim()) {
      messages.push({ time: time.trim(), role: roleText === '客服' ? 'waiter' : 'customer', text: contentClean });
      lastTime = time.trim();
    }
  });
  return { messages, errors };
}

function looksLikeJdRaw(obj) {
  return !!(obj && (Array.isArray(obj.chatLogList)
    || (obj.data && Array.isArray(obj.data.chatLogList))
    || (obj.data && Array.isArray(obj.data))));
}

function looksLikeStandard(obj) {
  return !!(obj && obj.format === 'chat-record/1' && Array.isArray(obj.messages));
}

function looksLikeMessageArray(obj) {
  return Array.isArray(obj) && obj.length > 0 && obj.some((m) => m && (m.waiterSend !== undefined || m.role || m.created || m.time));
}

/** 把任意可导入对象转成标准聊天记录 */
function normalizeImportObject(obj, { sid } = {}) {
  if (looksLikeStandard(obj)) {
    const check = validateChat(obj);
    if (!check.ok) throw new Error(`标准聊天记录校验失败：${check.errors.join('；')}`);
    return { chat: obj, source: 'standard' };
  }
  if (looksLikeJdRaw(obj)) {
    return { chat: rawSessionToChat(obj, { sid }), source: 'jd-raw' };
  }
  if (looksLikeMessageArray(obj)) {
    const messages = obj
      .map((m) => normalizeMessage(m))
      .filter((m) => m && (m.text !== '' || m.img));
    const chat = makeChat({ platform: 'manual', messages });
    const check = validateChat(chat);
    if (!check.ok) throw new Error(`消息数组转换失败：${check.errors.join('；')}`);
    return { chat, source: 'messages' };
  }
  throw new Error('文件内容无法识别：请提供 标准聊天记录JSON / 京东原始JSON / 或 文本格式（时间|客服或客户|内容）');
}

/** 从文件导入 */
function importFromFile(filePath, { sid } = {}) {
  if (!fs.existsSync(filePath)) throw new Error(`文件不存在：${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      throw new Error(`JSON 解析失败：${e.message}`);
    }
    return normalizeImportObject(obj, { sid });
  }
  if (ext === '.txt' || ext === '.md' || ext === '.log') {
    const { messages, errors } = parseImportText(fs.readFileSync(filePath, 'utf8'));
    if (errors.length > 0) throw new Error(`文本解析有 ${errors.length} 行格式不对：\n${errors.slice(0, 5).join('\n')}`);
    const chat = makeChat({ platform: 'manual', messages });
    const check = validateChat(chat);
    if (!check.ok) throw new Error(`文本转聊天记录失败：${check.errors.join('；')}`);
    return { chat, source: 'text' };
  }
  throw new Error(`不支持的文件类型：${ext}（支持 .json / .txt / .md）`);
}

module.exports = { parseImportText, importFromFile, normalizeImportObject };
