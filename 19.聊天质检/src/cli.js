// 聊天质检命令入口：只编排参数、调用 services、输出结果。
const fs = require('fs');
const { createWorkspace } = require('./services/paths');
const { loadConfig } = require('./services/config');
const { listChatFiles, readChat, writeChat } = require('./services/chatStore');
const { listPages, pickCandidates, fetchJdSummaryAndChat } = require('./services/jdFetch');
const { importFromFile } = require('./services/importers');
const { launchVisibleBrowser, waitForDebugPort } = require('./services/browserSession');
const {
  buildFeedbackPreview,
  loadWecomFeedbackConfig,
  resolveFeedbackTarget
} = require('./services/wecomFeedback');

function today() {
  const d = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      opts[key] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (opts[key] !== true) i += 1;
    } else {
      opts._.push(arg);
    }
  }
  return opts;
}

function usage() {
  console.log(`聊天质检助手 v0.1
用法: node src/cli.js <子命令> [参数]

  browser:start [--browser edge|chrome|auto] [--port 9333]
              拉起独立浏览器登录京东客服后台
  fetch:list  [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--customer 值] [--port 9333]
              从后台列出会话
  fetch:save  <sid> [同上参数]    保存指定会话到 runtime/chat
  import      <文件路径>          导入 txt/json 聊天记录
  wecom:preview [聊天文件] (--content "待沟通文案" | --content-file 文案文件)
              解析昵称、客服和@方式，只输出预览，绝不访问 webhook

建议流程:
  node src/cli.js browser:start
  # 手工完成京东登录，回到聊天记录页
  node src/cli.js fetch:list --start ${today()}
  node src/cli.js fetch:save <sid> --start ${today()}
  # AI/人工通读 runtime/chat/*.chat.json 后再做售前质检
  # 反馈发送前先和用户确认内容与是否发送；当前命令只做预览
`);
}

async function cmdBrowserStart(ws, cfg, opts) {
  const port = Number(opts.port) || cfg.cdp.port;
  const browser = String(opts.browser || cfg.cdp.browser || 'edge');
  const targetUrl = String(opts.url || cfg.cdp.loginUrl || '').trim();
  const userDataDir = ws.dirs.browserProfile;
  const result = await launchVisibleBrowser({ browser, port, userDataDir, targetUrl });
  const ready = await waitForDebugPort(port, { timeoutMs: 15000 });
  console.log(`✔ 已启动独立浏览器：${result.executablePath}`);
  console.log(`  PID=${result.pid}｜调试端口=${port}｜资料目录=${userDataDir}`);
  console.log(`  登录页：${targetUrl}`);
  console.log(`  CDP状态：${ready ? '已就绪' : '窗口已启动但端口尚未就绪，请稍后重试'}`);
}

async function cmdFetchList(ws, cfg, opts) {
  const port = Number(opts.port) || cfg.cdp.port;
  const pages = await listPages({ port });
  const candidates = pickCandidates(pages, cfg.cdp.pageTitleMatch);
  if (candidates.length === 0) {
    const opened = pages.slice(0, 8).map((page) => `  - ${page.title} | ${page.url}`).join('\n');
    throw new Error(`没有匹配「${cfg.cdp.pageTitleMatch}」的页面。已打开页面：\n${opened || '（无）'}`);
  }
  const query = {
    customer: opts.customer || '',
    startTime: opts.start || today(),
    endTime: opts.end || opts.start || today()
  };
  const pageInfo = candidates[0].page;
  console.log(`页面：${pageInfo.title}｜查询：${query.startTime} ~ ${query.endTime}`);
  const fetched = await fetchJdSummaryAndChat({
    pageInfo,
    apiBase: cfg.cdp.apiBase,
    query,
    pageSize: cfg.cdp.pageSize
  });
  if (fetched.summary.length === 0) {
    console.log('✗ 未查到会话（检查日期区间、登录店铺或页面筛选条件）。');
    return;
  }
  fetched.summary.forEach((item) => {
    console.log(`[${item.sid}] ${item.firstTime || '?'} | ${item.customer || '?'} | ${item.messageCount}条 | ${(item.headline || '').slice(0, 40)}`);
  });
  console.log(`\n共 ${fetched.summary.length} 个会话。下一步：node src/cli.js fetch:save <sid> --start ${query.startTime}`);
}

async function cmdFetchSave(ws, cfg, opts, sid) {
  if (!sid) throw new Error('缺少 <sid>（先运行 fetch:list 查看）');
  const port = Number(opts.port) || cfg.cdp.port;
  const pages = await listPages({ port });
  const candidates = pickCandidates(pages, cfg.cdp.pageTitleMatch);
  if (candidates.length === 0) throw new Error(`没有匹配「${cfg.cdp.pageTitleMatch}」的页面。`);
  const query = {
    customer: opts.customer || '',
    startTime: opts.start || today(),
    endTime: opts.end || opts.start || today()
  };
  const fetched = await fetchJdSummaryAndChat({
    pageInfo: candidates[0].page,
    apiBase: cfg.cdp.apiBase,
    query,
    pageSize: cfg.cdp.pageSize
  });
  const chat = fetched.toChat(sid);
  if (!chat || !chat.messages.length) throw new Error(`会话 ${sid} 未取到消息。`);
  const saved = writeChat(ws, chat);
  console.log(`✔ 已保存：${saved.file}（${chat.messages.length} 条）`);
}

async function cmdImport(ws, opts) {
  const file = opts._[0];
  if (!file) throw new Error('缺少文件路径：node src/cli.js import <路径>');
  const imported = importFromFile(file);
  const saved = writeChat(ws, imported.chat);
  console.log(`✔ 已导入（${imported.source}）：${saved.file}（${imported.chat.messages.length} 条）`);
}

async function cmdWecomPreview(ws, opts) {
  const config = loadWecomFeedbackConfig(ws);
  const fileName = opts._[0] || opts.chat || '';
  const chat = fileName ? readChat(ws, fileName) : null;
  const hasInlineContent = opts.content !== undefined;
  const hasContentFile = opts['content-file'] !== undefined;
  if (hasInlineContent && hasContentFile) {
    throw new Error('--content 和 --content-file 只能二选一；建议多行文案使用 --content-file。');
  }
  let content = '';
  if (hasContentFile) {
    const contentFile = String(opts['content-file'] || '').trim();
    if (!contentFile) throw new Error('--content-file 不能为空。');
    try {
      content = fs.readFileSync(contentFile, 'utf8').trim();
    } catch (error) {
      throw new Error(`读取反馈文案文件失败：${error.message}`);
    }
  } else {
    content = String(opts.content || '').trim();
  }
  if (!content) {
    throw new Error('缺少 --content 或 --content-file；反馈文案必须先由用户与 AI/人工沟通确定。');
  }

  const target = resolveFeedbackTarget({
    chat,
    nickname: opts.nickname,
    staffName: opts.staff,
    sourceNote: opts.source
  }, config);
  const preview = buildFeedbackPreview({ content, chat, target, config });
  const safePreview = {
    webhookConfigured: Boolean(config.webhookUrl),
    ...preview,
    payload: {
      msgtype: preview.payload.msgtype,
      text: {
        content: preview.payload.text.content,
        mentioned_mobile_list_count: preview.payload.text.mentioned_mobile_list.length
      }
    }
  };
  console.log(JSON.stringify(safePreview, null, 2));
  console.log('\n未发送：wecom:preview 不会访问企业微信 webhook。');
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    usage();
    return;
  }
  const command = args[0];
  const opts = parseArgs(args.slice(1));
  const ws = createWorkspace();
  ws.ensure();
  const cfg = loadConfig(ws);
  try {
    if (command === 'browser:start') await cmdBrowserStart(ws, cfg, opts);
    else if (command === 'fetch:list') await cmdFetchList(ws, cfg, opts);
    else if (command === 'fetch:save') await cmdFetchSave(ws, cfg, opts, opts._[0]);
    else if (command === 'import') await cmdImport(ws, opts);
    else if (command === 'wecom:preview') await cmdWecomPreview(ws, opts);
    else {
      console.error(`未知子命令：${command}`);
      usage();
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`✗ ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}

main();
