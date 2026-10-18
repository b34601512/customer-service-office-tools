#!/usr/bin/env node
// 跟读收件箱：挂在 Monitor 上，收件箱一有新行就打印一行 —— 打印会触发 monitor:output 事件，
// 事件唤醒 AI（消息一到就秒级响应，不必定时轮询）。平时保持安静：没新消息不输出，免得假唤醒。
//
// 2026-10-13 v2（对齐王语嫣核心 .40 的修复，防「空响」）——两道保险：
//   ① 消息级去重：同一条（认 msgid/reqId，认不出按整行指纹）不重播；文件被重写/轮转回读、
//      事件重放时，旧消息不会再打一遍（一次重放＝一串假唤醒，能防就防）。
//   ② 游标续跟：记住「已跟到第几条、最后一条的 ID」（.state/收件箱跟读.json）；监听重启后从
//      断点接着打——停机期间进来的消息启动时补打，旧消息不重打；断点对不上（文件大改）→
//      静默从当前末尾跟，不回溯重放。
//
// 只打印「时间 + 单聊/群聊 + 类型 + 正文摘要」，**不打印任何内部 ID**（userid / chat_id / msgid）。
//
// 2026-10-18 v3 单实例闸（技术·王语嫣报「机器上同时跑着 3 个跟读进程，前两个父进程早已死」）——
//   根源不是「这次重复了」，是**结构性重复**：每次续窗/重启都新起一个，旧的没人收，
//   而程序启动时从不问「我是不是已经在跟了」。只杀一遍＝小修小补（老板 2026-10-18 20:19 令：要挖根源）。
//   做法：启动先看锁文件里的 pid 还活不活；活着就自己退出（exit 0，不算故障）。
//   锁只认自己的 `.state` 目录 → 各家互不干扰。--文件 模式（联调/单测）不设闸，避免互锁。
//
// 用法：
//   node scripts/跟读收件箱.cjs              # 从游标续跟（首次从末尾起）
//   node scripts/跟读收件箱.cjs --从头        # 忽略游标，把已有消息全打一遍（调试用）
//   node scripts/跟读收件箱.cjs --文件 <路径> # 改读别的文件（联调用，不碰真实收件箱）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const 根目录 = path.resolve(__dirname, '..');
const 默认收件箱 = path.join(根目录, '.state', 'inbox.jsonl');
const 默认状态文件 = path.join(根目录, '.state', '收件箱跟读.json');
const 默认锁文件 = path.join(根目录, '.state', '跟读收件箱.pid');
const 去重窗口 = 500; // 记住最近这么多条消息的身份证（够盖住整箱重写）
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

/** 一条记录的「身份证」：优先 msgid/reqId；都没有就用整行指纹。 */
function 行ID(行) {
  try {
    const r = JSON.parse(行);
    const id = String(r.msgid || r.reqId || '').trim();
    if (id) return id;
  } catch {
    /* 落到指纹 */
  }
  return 'fp:' + crypto.createHash('sha1').update(行).digest('hex').slice(0, 20);
}

/** 造一个去重器：同一个 ID 只放行一次；窗口滚动（保序列表 + 集合）。 */
function 造去重器(近ID表, 近ID集) {
  return (id) => {
    if (近ID集.has(id)) return false;
    近ID集.add(id);
    近ID表.push(id);
    if (近ID表.length > 去重窗口) {
      for (const x of 近ID表.splice(0, 近ID表.length - 去重窗口)) 近ID集.delete(x);
    }
    return true;
  };
}

function 载状态(状态文件) {
  try {
    const j = JSON.parse(fs.readFileSync(状态文件, 'utf8'));
    return {
      已播条数: Math.max(0, Math.trunc(Number(j.已播条数) || 0)),
      尾ID: String(j.尾ID || ''),
      近ID: Array.isArray(j.近ID) ? j.近ID.map(String) : [],
    };
  } catch {
    return { 已播条数: 0, 尾ID: '', 近ID: [] };
  }
}

function 存状态(状态文件, 状态) {
  try {
    fs.mkdirSync(path.dirname(状态文件), { recursive: true });
    const 临时 = 状态文件 + '.tmp';
    fs.writeFileSync(临时, JSON.stringify({ ...状态, 更新时间: new Date().toISOString() }, null, 2), 'utf8');
    fs.renameSync(临时, 状态文件);
  } catch {
    /* 写不进去不致命：大不了下次重启从末尾起跟 */
  }
}

/** 启动读一遍：按游标续跟（补打停机期间的新消息）/ 首次从末尾起；返回运行态，供跟读循环用。 */
function 启动读一遍(收件箱, 状态文件, 从头, 输出) {
  const 旧状态 = 载状态(状态文件);
  const 近ID表 = 旧状态.近ID.slice(-去重窗口);
  const 近ID集 = new Set(近ID表);
  const 记ID = 造去重器(近ID表, 近ID集);

  let 已播条数 = 0;
  let 尾ID = '';
  const 打一行 = (行, 忽略去重 = false) => {
    const id = 行ID(行);
    if (!忽略去重 && !记ID(id)) return false; // 见过 → 不重播
    输出(摘要行(行));
    return true;
  };

  const 原始 = fs.existsSync(收件箱) ? fs.readFileSync(收件箱, 'utf8') : '';
  const 尾切 = 原始.lastIndexOf('\n');
  const 全部 = (尾切 >= 0 ? 原始.slice(0, 尾切) : '').split('\n').map((l) => l.trim()).filter(Boolean);
  const 末行ID = () => (全部.length ? 行ID(全部[全部.length - 1]) : '');

  if (从头) {
    // 调试：全打一遍（去重不生效、随后按本次位置建游标）
    for (const l of 全部) 打一行(l, true);
    近ID表.length = 0;
    近ID集.clear();
    for (const l of 全部.slice(-去重窗口)) 记ID(行ID(l));
    已播条数 = 全部.length;
    尾ID = 末行ID();
  } else if (
    旧状态.已播条数 > 0 &&
    旧状态.已播条数 <= 全部.length &&
    行ID(全部[旧状态.已播条数 - 1]) === 旧状态.尾ID
  ) {
    // 续跟：断点对得上 → 补打停机期间的新消息（旧消息被近ID挡着，不会重播）
    const 新 = 全部.slice(旧状态.已播条数);
    for (const l of 新) 打一行(l);
    已播条数 = 旧状态.已播条数 + 新.length;
    尾ID = 新.length ? 行ID(新[新.length - 1]) : 旧状态.尾ID;
  } else {
    // 首次，或文件动过对不上：从当前末尾起跟（不回溯重放）；末尾这些记进去重表，
    // 将来文件被重写回读时也不会重播
    已播条数 = 全部.length;
    尾ID = 末行ID();
    for (const l of 全部.slice(-去重窗口)) 记ID(行ID(l));
  }
  存状态(状态文件, { 已播条数, 尾ID, 近ID: 近ID表 });
  return { 已播条数, 尾ID, 近ID表, 近ID集 };
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

/** 单实例闸：锁文件里的 pid 还活着就返回它（只探不杀）；不存在/已死/读不了 → 返回 0。 */
function 已有实例在跟(锁文件 = 默认锁文件) {
  try {
    const 旧 = Number(String(fs.readFileSync(锁文件, 'utf8')).trim());
    if (!旧 || 旧 === process.pid) return 0;
    process.kill(旧, 0); // 只探不杀：进程在 → 不抛；不在 → 抛
    return 旧;
  } catch {
    return 0;
  }
}

/** 占锁 + 挂退出清理（只清自己的锁，别人的不碰）；返回清理函数，便于单测。 */
function 占锁(锁文件 = 默认锁文件) {
  try {
    fs.mkdirSync(path.dirname(锁文件), { recursive: true });
    fs.writeFileSync(锁文件, String(process.pid), 'utf8');
  } catch {
    /* 写不了锁不致命：照样跟读，只是防不住重复 */
  }
  const 清锁 = () => {
    try {
      if (Number(String(fs.readFileSync(锁文件, 'utf8')).trim()) === process.pid) fs.unlinkSync(锁文件);
    } catch {
      /* ignore */
    }
  };
  process.once('exit', 清锁);
  for (const 信号 of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(信号, () => { 清锁(); process.exit(0); });
  return 清锁;
}

function 主流程() {
  const 参数 = 取参数(process.argv.slice(2));
  const 状态文件 = 参数.文件 === 默认收件箱 ? 默认状态文件 : 参数.文件 + '.跟读状态.json';

  // 单实例闸只在「跟真实收件箱」时生效：--文件 是联调/单测通道，不该被彼此挡住
  if (参数.文件 === 默认收件箱) {
    const 旧 = 已有实例在跟();
    if (旧) {
      console.error(`[跟读收件箱] 已有实例在跑（pid ${旧}），本进程退出——同一条收件箱只许挂一条监听。`);
      process.exit(0);
    }
    占锁();
  }

  const 运行态 = 启动读一遍(参数.文件, 状态文件, 参数.从头, (行) => console.log(行));
  const 记ID = 造去重器(运行态.近ID表, 运行态.近ID集);

  const 原始 = fs.existsSync(参数.文件) ? fs.readFileSync(参数.文件, 'utf8') : '';
  const 尾切 = 原始.lastIndexOf('\n');
  let 偏移 = 尾切 >= 0 ? Buffer.byteLength(原始.slice(0, 尾切 + 1), 'utf8') : 0;

  const 跟 = () => {
    const 结果 = 读新字节(参数.文件, 偏移);
    const 轮转过 = 结果.偏移 < 偏移; // 文件被清空/重写：这一轮读到的是全体行
    for (const 行 of 结果.行) {
      if (记ID(行ID(行))) console.log(摘要行(行));
    }
    偏移 = 结果.偏移;
    if (结果.行.length) {
      运行态.已播条数 = 轮转过 ? 结果.行.length : 运行态.已播条数 + 结果.行.length;
      运行态.尾ID = 行ID(结果.行[结果.行.length - 1]);
      存状态(状态文件, { 已播条数: 运行态.已播条数, 尾ID: 运行态.尾ID, 近ID: 运行态.近ID表 });
    }
  };
  setInterval(跟, 轮询毫秒);
}

if (require.main === module) 主流程();

module.exports = { 读新字节, 摘要行, 本地时分, 取参数, 默认收件箱, 行ID, 造去重器, 启动读一遍, 已有实例在跟, 占锁, 默认锁文件 };
