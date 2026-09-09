// 聊天记录文件存取（纯业务）：标准 JSON 落盘 runtime/chat/，解析文件在 runtime/review/ 同基名
const fs = require('fs');
const path = require('path');
const { validateChat } = require('./chatSchema');
const { sanitize } = require('./paths');

function chatFileName(chat) {
  const base = [chat.meta.window, chat.meta.customer || chat.meta.orderId || '会话']
    .filter(Boolean)
    .join('_');
  return `${sanitize(base)}.chat.json`;
}

function listChatFiles(ws) {
  return ws.listJson(ws.dirs.chat);
}

function readChat(ws, fileName) {
  const file = path.join(ws.dirs.chat, fileName);
  if (!fs.existsSync(file)) throw new Error(`聊天记录不存在：${fileName}`);
  let chat;
  try {
    chat = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`聊天记录文件损坏 ${fileName}: ${e.message}`);
  }
  const check = validateChat(chat);
  if (!check.ok) throw new Error(`聊天记录校验失败 ${fileName}：${check.errors.join('；')}`);
  return chat;
}

function writeChat(ws, chat) {
  const check = validateChat(chat);
  if (!check.ok) throw new Error(`拒绝写入不合法聊天记录：${check.errors.join('；')}`);
  ws.ensure();
  const fileName = chatFileName(chat);
  const file = path.join(ws.dirs.chat, fileName);
  fs.writeFileSync(file, JSON.stringify(chat, null, 2), 'utf8');
  return { fileName, file };
}

/** 聊天记录对应的解析文件路径（runtime/review/<基名>.review.json） */
function reviewFileFor(ws, chatFileOrName) {
  const base = sanitize(ws.baseNameOf(chatFileOrName));
  return { base, file: path.join(ws.dirs.review, `${base}.review.json`) };
}

module.exports = { listChatFiles, readChat, writeChat, reviewFileFor, chatFileName };
