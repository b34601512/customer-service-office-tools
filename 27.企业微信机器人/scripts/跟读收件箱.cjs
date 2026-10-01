#!/usr/bin/env node
// 跟读收件箱：挂在 Monitor 上，收件箱一有新行就打印一行 —— 打印会触发 monitor:output 事件，
// 事件唤醒 AI（消息一到就秒级响应，不必定时轮询）。平时保持安静：没新消息不输出，免得假唤醒。
//
// 只打印「时间 + 单聊/群聊 + 类型 + 正文摘要」，**不打印任何内部 ID**（userid / chat_id / msgid）。
//
// 用法：
//   node scripts/跟读收件箱.cjs              # 从当前文件末尾开始跟（守护已在跑时用这个）
//   node scripts/跟读收件箱.cjs --从头        # 先把已有消息打一遍（调试用）
//   node scripts/跟读收件箱.cjs --文件 <路径> # 改读别的文件（联调用，不碰真实收件箱）
const fs = require('fs');
const path = require('path');

const 根目录 = path.resolve(__dirname, '..');
const 默认收件箱 = path.join(根目录, '.state', 'inbox.jsonl');
const 轮询毫秒 = 1500;

/** 从「偏移」处读出新增的完整行；返回新偏移（半行不读，留到下一轮拼接）。 */
function 读新字节(文件, 偏移) {
  const 大小 = fs.existsSync(文件) ? fs.statSync(文件).size : 0;
  if (大小 < 偏移) 偏移 = 0; // 文件被清空/轮转过 → 从头再来
  if (大小 === 偏移) return { 偏移, 行: [] };
  const fd = fs.openSync(文件, 'r');
  const 缓冲 = Buffer.alloc(大小 - 偏移);
  fs.readSync(fd, 缓冲, 0, 缓冲.length, 偏移);
  fs.closeSync(fd);
  const 切开 = 缓冲.toString('utf8').split('\n');
  const 半行 = 切开.pop() || '';
  return { 偏移: 大小 - Buffer.byteLength(半行, 'utf8'), 行: 切开.filter((行) => 行.trim()) };
}

/** 收件时间 → 本地 HH:MM（记录里有本地时间字符串，也有 ISO/UTC，得统一；否则显示会差 8 小时）。 */
function 本地时分(原始) {
  const 文本 = String(原始 || '');
  if (/^\d{4}-\d{2}-\d{2}T/.test(文本)) {
    const 时刻 = new Date(文本);
    if (!Number.isNaN(时刻.getTime())) {
      const 补 = (n) => String(n).padStart(2, '0');
      return `${补(时刻.getHours())}:${补(时刻.getMinutes())}`;
    }
  }
  return 文本.slice(11, 16);
}

/** 一行收件记录 → 给人看的一行摘要（纯函数，便于单测；不含内部 ID）。 */
function 摘要行(行) {
  let 记录;
  try {
    记录 = JSON.parse(行);
  } catch {
    return '【新消息】收到一条读不出来的记录（去 .state/inbox.jsonl 看原文）';
  }
  const 时间 = 本地时分(记录.at);
  const 谁 = 记录.chattype === 'group' ? '群聊' : 记录.chattype === 'single' ? '单聊' : String(记录.chattype || '会话');
  const 类 = String(记录.kind || 记录.msgtype || '消息');
  const 引用 = 记录.quoteText ? '（含引用）' : '';
  const 正文 = String(记录.text || 记录.note || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const 附件 = 记录.mediaPath ? '（附件已存 .state/media）' : '';
  return `【新消息】${时间} ${谁}[${类}]${引用} ${正文}${附件}`.trimEnd();
}

/** 解析命令行（纯函数，便于单测）。 */
function 取参数(argv) {
  const 参数 = { 从头: false, 文件: 默认收件箱 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--从头') 参数.从头 = true;
    else if (argv[i] === '--文件') {
      参数.文件 = String(argv[i + 1] || '').trim() || 默认收件箱;
      i += 1;
    }
  }
  return 参数;
}

function 主流程() {
  const 参数 = 取参数(process.argv.slice(2));
  let 偏移 = 参数.从头 ? 0 : (fs.existsSync(参数.文件) ? fs.statSync(参数.文件).size : 0);
  const 跟 = () => {
    const 结果 = 读新字节(参数.文件, 偏移);
    偏移 = 结果.偏移;
    for (const 行 of 结果.行) console.log(摘要行(行));
  };
  if (参数.从头) 跟();
  setInterval(跟, 轮询毫秒);
}

if (require.main === module) 主流程();

module.exports = { 读新字节, 摘要行, 本地时分, 取参数, 默认收件箱 };
