// 课件制作助手 命令入口（AI 驱动，替代原 TUI 薄壳）：
// 只做参数解析与输出，业务全部走 src/services（唯一真源）。
// 用法见 SKILL.md 命令表。
const { createWorkspace } = require('./services/paths');
const { loadConfig } = require('./services/config');
const { listChatFiles, writeChat, reviewFileFor } = require('./services/chatStore');
const { listPages, pickCandidates, fetchJdSummaryAndChat } = require('./services/jdFetch');
const { importFromFile } = require('./services/importers');
const { generateCourseware } = require('./services/courseworkService');

// ---------- 参数解析 ----------
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      opts[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (opts[key] !== true) i++;
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

function usage() {
  console.log(`课件制作助手 命令入口 v0.2（AI 驱动）
用法: node src/cli.js <子命令> [参数]

  fetch:list  [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--customer 值] [--port 端口]
              连接已登录 Chrome 调试端口，列出匹配会话（供选 sid）
  fetch:save  <sid> [同上参数]    抓取并保存指定会话为聊天记录文件
  import      <文件路径>          导入 txt/json 聊天记录
  generate    [聊天文件基名]      出片+自检（缺省用最近的聊天记录；需同名解析文件）
示例:
  node src/cli.js fetch:list --start 2026-08-05
  node src/cli.js fetch:save 3728192 --start 2026-08-05
  node src/cli.js import runtime/chat/我的案例.txt
  node src/cli.js generate 2026年8月/涨价应对-xxx`);
}

// ---------- 取数：列出会话 ----------
async function cmdFetchList(ws, cfg, opts) {
  const port = Number(opts.port) || cfg.cdp.port;
  const pages = await listPages({ port });
  const cands = pickCandidates(pages, cfg.cdp.pageTitleMatch);
  if (cands.length === 0) {
    const list = pages.slice(0, 8).map((p) => `  - ${p.title} | ${p.url}`).join('\n');
    throw new Error(`没有匹配「${cfg.cdp.pageTitleMatch}」的页面。已打开页面：\n${list || '（无）'}`);
  }
  const pageInfo = cands[0].page;
  const query = {
    customer: opts.customer || '',
    startTime: opts.start || today(),
    endTime: opts.end || opts.start || today(),
  };
  console.log(`页面：${pageInfo.title}｜查询：${query.startTime} ~ ${query.endTime}${query.customer ? '｜客户/关键字：' + query.customer : ''}`);
  const fetched = await fetchJdSummaryAndChat({ pageInfo, apiBase: cfg.cdp.apiBase, query, pageSize: cfg.cdp.pageSize });
  if (fetched.summary.length === 0) {
    console.log('✗ 未查到会话（检查日期区间/登录店铺/是否有记录）。');
    return;
  }
  fetched.summary.forEach((s) => {
    console.log(`[${s.sid}] ${s.firstTime || '?'} | ${s.customer || '?'} | ${s.messageCount}条 | ${(s.headline || '').slice(0, 30)}`);
  });
  console.log(`\n共 ${fetched.summary.length} 个会话。要保存哪个：node src/cli.js fetch:save <sid> ${opts.start ? '--start ' + opts.start : ''}${query.customer ? ' --customer ' + query.customer : ''}`);
}

// ---------- 取数：保存指定会话 ----------
async function cmdFetchSave(ws, cfg, opts, sid) {
  if (!sid) throw new Error('缺少 <sid>（先跑 fetch:list 查看）');
  const port = Number(opts.port) || cfg.cdp.port;
  const pages = await listPages({ port });
  const cands = pickCandidates(pages, cfg.cdp.pageTitleMatch);
  if (cands.length === 0) throw new Error(`没有匹配「${cfg.cdp.pageTitleMatch}」的页面。`);
  const pageInfo = cands[0].page;
  const query = {
    customer: opts.customer || '',
    startTime: opts.start || today(),
    endTime: opts.end || opts.start || today(),
  };
  const fetched = await fetchJdSummaryAndChat({ pageInfo, apiBase: cfg.cdp.apiBase, query, pageSize: cfg.cdp.pageSize });
  const chat = fetched.toChat(sid);
  if (!chat || !chat.messages || chat.messages.length === 0) throw new Error(`会话 ${sid} 未取到消息（sid 可能不对或窗口内无此会话）。`);
  const saved = writeChat(ws, chat);
  console.log(`✔ 已保存：${saved.file}（${chat.messages.length} 条）`);
  console.log(`下一步：读该文件确认主题与教学场景，然后写解析文件，再跑 generate。`);
}

// ---------- 导入 ----------
async function cmdImport(ws, opts) {
  const file = opts._[0];
  if (!file) throw new Error('缺少文件路径：node src/cli.js import <路径>');
  const r = importFromFile(file);
  const saved = writeChat(ws, r.chat);
  console.log(`✔ 已导入（${r.source}）：${saved.file}（${r.chat.messages.length} 条）`);
}

// ---------- 生成课件 ----------
async function cmdGenerate(ws, opts) {
  const chats = listChatFiles(ws);
  if (chats.length === 0) throw new Error('还没有聊天记录，先 fetch:save 或 import。');
  const want = opts._[0];
  const chatFile = want ? chats.find((c) => c.includes(want)) : chats[chats.length - 1];
  if (!chatFile) throw new Error(`没找到含「${want}」的聊天记录。现有：${chats.join('、')}`);
  const reviewPath = reviewFileFor(ws, chatFile);
  const result = await generateCourseware(ws, { chatFile });
  if (result.status === 'needReview') {
    console.log('✗ 解析文件缺失或空，请先写解析：' + result.reviewPath + '\n写法和契约见 SKILL.md');
  } else if (result.status === 'invalid') {
    console.log('✗ 解析文件校验不过：');
    result.errors.forEach((e) => console.log('  ' + e));
    (result.warnings || []).forEach((w) => console.log('  ⚠ ' + w));
    console.log('解析文件：' + reviewPath);
  } else {
    console.log(`✔ 已生成：${result.htmlPath}`);
    (result.checkItems || []).forEach((c) => console.log(`  ${c.pass ? '✔' : '✗'} ${c.name}`));
    if (result.checkItems && result.checkItems.some((c) => !c.pass)) process.exitCode = 1;
  }
}

// ---------- 主入口 ----------
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    usage();
    return;
  }
  const sub = args[0];
  const opts = parseArgs(args.slice(1));
  const ws = createWorkspace();
  ws.ensure();
  const cfg = loadConfig(ws);
  try {
    if (sub === 'fetch:list') await cmdFetchList(ws, cfg, opts);
    else if (sub === 'fetch:save') await cmdFetchSave(ws, cfg, opts, opts._[0]);
    else if (sub === 'import') await cmdImport(ws, opts);
    else if (sub === 'generate') await cmdGenerate(ws, opts);
    else { console.error(`未知子命令：${sub}`); usage(); process.exitCode = 1; }
  } catch (e) {
    console.error('✗ ' + (e && e.message || e));
    process.exitCode = 1;
  }
}

main();