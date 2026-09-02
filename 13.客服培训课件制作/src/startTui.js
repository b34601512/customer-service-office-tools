// 课件制作助手 TUI（薄壳）：只负责菜单/输入/输出，业务全部走 src/services。
const { execFile } = require('child_process');
const { makeUi } = require('./tui/ui');
const { createWorkspace } = require('./services/paths');
const { loadConfig, saveConfig } = require('./services/config');
const { listChatFiles, writeChat, reviewFileFor } = require('./services/chatStore');
const { listPages, pickCandidates, fetchJdSummaryAndChat } = require('./services/jdFetch');
const { parseImportText, importFromFile } = require('./services/importers');
const { makeChat } = require('./services/chatSchema');
const { generateCourseware } = require('./services/courseworkService');

const APP = '客服培训课件制作助手 v0.1';

function openFolder(ui, dir) {
  if (process.platform !== 'win32') { ui.line(`目录：${dir}`); return; }
  execFile('cmd', ['/c', 'start', '', dir], () => {});
  ui.line(`已打开：${dir}`);
}

function printChatPreview(ui, chat, limit = 12) {
  ui.line(`共 ${chat.messages.length} 条消息，前 ${Math.min(limit, chat.messages.length)} 条：`);
  chat.messages.slice(0, limit).forEach((m) => {
    const who = m.role === 'customer' ? '客户' : '客服';
    const t = (m.time || '').slice(11, 16);
    ui.line(`  [${t}] ${who}：${m.img ? '[图片]' : (m.text || '').slice(0, 30)}`);
  });
}

// ---------- 流程：京东抓取 ----------
async function flowFetchJd(ws, cfg, ui) {
  ui.header('1. 从京东抓取聊天记录');
  try {
    const pages = await listPages({ port: cfg.cdp.port });
    const cands = pickCandidates(pages, cfg.cdp.pageTitleMatch);
    let pageInfo;
    if (cands.length === 1) {
      pageInfo = cands[0].page;
      ui.line(`自动选用页面：${pageInfo.title}（${pageInfo.url}）`);
    } else if (cands.length > 1) {
      const idx = await ui.askChoice('有多个匹配页面，选哪个？', cands.map((c) => `${c.page.title}`));
      if (idx < 0) return;
      pageInfo = cands[idx].page;
    } else if (pages.length > 0) {
      const idx = await ui.askChoice('未找到「京东客服管家」页面，请从打开的页面中选择：', pages.map((p) => `${p.title} | ${p.url}`));
      if (idx < 0) return;
      pageInfo = pages[idx];
      ui.line('⚠ 该页面可能不是京东客服管家，若抓取异常请回主菜单设置。');
    } else {
      throw new Error('调试端口没有可用的页面。请确认已打开京东后台并登录。');
    }

    const kind = await ui.askChoice('查询方式', ['按 客户pin/订单号/关键字 查（填进 customer 参数）', '仅按日期拉该日全部会话']);
    let customer = '';
    if (kind === 0) customer = await ui.askText('查询值（客户pin / 订单号 / 关键字，可留空）> ', { allowEmpty: true });
    const startTime = await ui.askText(`开始日期 YYYY-MM-DD（回车=今天 ${ui.todayDate()}）> `, { allowEmpty: true }) || ui.todayDate();
    const endTime = await ui.askText(`结束日期 YYYY-MM-DD（回车=同上）> `, { allowEmpty: true }) || startTime;

    ui.line('\n正在抓取（单日/窄窗口查询，多页自动翻取）……');
    const fetched = await fetchJdSummaryAndChat({
      pageInfo, apiBase: cfg.cdp.apiBase, pageSize: cfg.cdp.pageSize,
      query: { customer, startTime, endTime }
    });
    if (fetched.summary.length === 0) {
      ui.line('✗ 未查到会话。可能原因：日期区间过大、登录的不是目标店铺、或该日无记录。');
      await ui.pause(); return;
    }
    ui.line(`\n查到 ${fetched.summary.length} 个会话：`);
    const labels = fetched.summary.map((s) => `${s.firstTime || '?'} | ${s.customer || '?'} | ${s.messageCount}条 | ${(s.headline || '').slice(0, 24)}`);
    const idx = await ui.askChoice('选哪个会话做课件？', labels);
    if (idx < 0) return;
    const chat = fetched.toChat(fetched.summary[idx].sid);
    const saved = writeChat(ws, chat);
    ui.line(`\n✔ 已保存聊天记录：${saved.file}`);
    printChatPreview(ui, chat);
    ui.line('\n提示：抓完请通读确认会话主题与教学场景匹配，再进入「生成课件」让 AI 写解析。');
  } catch (e) {
    ui.line(`✗ ${e.message}`);
  }
  await ui.pause();
}

// ---------- 流程：导入聊天记录 ----------
async function flowImport(ws, ui) {
  ui.header('2. 导入聊天记录（手动提供）');
  try {
    const way = await ui.askChoice('导入方式', ['粘贴文本（时间|客服|内容）', '从文件导入（.json / .txt）']);
    if (way < 0) return;
    let chat;
    if (way === 0) {
      const text = await ui.readMultiline('请粘贴聊天记录，每行格式：时间|客服|内容  或  时间|客户|内容（# 或 // 开头为注释），粘贴完在新的一行输入 end 回车。');
      const { messages, errors } = parseImportText(text);
      if (errors.length > 0) { ui.line(`✗ ${errors.length} 行格式不对：`); errors.slice(0, 5).forEach((e) => ui.line(`  ${e}`)); await ui.pause(); return; }
      if (messages.length === 0) { ui.line('✗ 没有解析到任何消息。'); await ui.pause(); return; }
      chat = makeChat({ platform: 'manual', messages });
    } else {
      const file = await ui.askText('文件完整路径> ', { allowEmpty: false });
      const r = importFromFile(file);
      chat = r.chat;
      ui.line(`已识别来源：${r.source}`);
    }
    const saved = writeChat(ws, chat);
    ui.line(`\n✔ 已保存聊天记录：${saved.file}`);
    printChatPreview(ui, chat);
  } catch (e) {
    ui.line(`✗ ${e.message}`);
  }
  await ui.pause();
}

// ---------- 流程：生成课件 ----------
async function flowGenerate(ws, ui) {
  ui.header('3. 生成培训课件 HTML');
  const chats = listChatFiles(ws);
  if (chats.length === 0) {
    ui.line('还没有聊天记录，请先用 1（京东抓取）或 2（导入）取数。');
    await ui.pause(); return;
  }
  const idx = await ui.askChoice('选聊天记录（随后程序会找同名 AI 解析文件）', chats);
  if (idx < 0) return;
  const chatFile = chats[idx];
  const rel = reviewFileFor(ws, chatFile);

  try {
    const result = await generateCourseware(ws, { chatFile });
    if (result.status === 'needReview') {
      ui.line(result.message);
      ui.line(`\n请让 AI 填写：${result.reviewPath}`);
      ui.line('填写说明见：课件制作助手/给AI的解析提示词模板.md');
      const go = await ui.askChoice('现在就打开该解析模板文件？', ['打开'] , { cancelLabel: '稍后' });
      if (go === 0) openFolder(ui, ws.dirs.review);
    } else if (result.status === 'invalid') {
      ui.line('✗ 解析文件校验不过：');
      result.errors.forEach((e) => ui.line(`  ${e}`));
      (result.warnings || []).forEach((w) => ui.line(`  ⚠ ${w}`));
    } else {
      ui.line(`✔ 已生成：${result.htmlPath}`);
      ui.showCheckReport(result.checkItems);
      const open = await ui.askChoice('打开成品？', ['打开 HTML'], { cancelLabel: '不打开' });
      if (open === 0) openFolder(ui, require('path').dirname(result.htmlPath));
    }
  } catch (e) {
    ui.line(`✗ ${e.message}`);
  }
  await ui.pause();
}

// ---------- 流程：文件管理 ----------
async function flowBrowse(ws, ui) {
  ui.header('4. 工作区文件管理');
  ui.line('  工作区：' + ws.dirs.root);
  ui.line(`  聊天记录：${ws.listJson(ws.dirs.chat).length} 个 ｜ 解析文件：${ws.listJson(ws.dirs.review).length} 个`);
  const idx = await ui.askChoice('打开哪个目录？', ['聊天记录', '解析文件', '成品输出', '配置文件', '日志']);
  if (idx < 0) return;
  const dirs = [ws.dirs.chat, ws.dirs.review, ws.dirs.outputs, ws.dirs.config, ws.dirs.logs];
  ws.ensure();
  openFolder(ui, dirs[idx]);
  await ui.pause();
}

// ---------- 流程：设置 ----------
async function flowSettings(ws, ui) {
  ui.header('5. 抓取与输出设置');
  for (;;) {
    const c = loadConfig(ws).cdp;
    ui.line(`  调试端口 port     : ${c.port}`);
    ui.line(`  页面标题匹配       : ${c.pageTitleMatch}`);
    ui.line(`  接口地址 apiBase   : ${c.apiBase}`);
    ui.line(`  每页条数 pageSize  : ${c.pageSize}`);
    ui.line(`  配置文件           : ${ws.configFile()}`);
    const idx = await ui.askChoice('要修改什么？', ['调试端口', '页面标题匹配词', '接口地址', '每页条数', '打开配置文件手动改']);
    if (idx < 0) return;
    const cfg = loadConfig(ws);
    try {
      if (idx === 0) cfg.cdp.port = Number(await ui.askText('调试端口（默认 9222）> ', { allowEmpty: true })) || 9222;
      else if (idx === 1) cfg.cdp.pageTitleMatch = (await ui.askText('页面标题匹配词（默认 京东客服管家）> ', { allowEmpty: true })) || '京东客服管家';
      else if (idx === 2) cfg.cdp.apiBase = await ui.askText('接口地址> ', { allowEmpty: false });
      else if (idx === 3) cfg.cdp.pageSize = Number(await ui.askText('每页条数（默认 50）> ', { allowEmpty: true })) || 50;
      else { openFolder(ui, ws.dirs.config); await ui.pause(); continue; }
      saveConfig(ws, cfg);
      ui.line('✔ 已保存。');
    } catch (e) {
      ui.line(`✗ ${e.message}`);
    }
  }
}

async function main() {
  const ui = makeUi();
  const ws = createWorkspace();
  let cfg;
  try {
    cfg = loadConfig(ws);
  } catch (e) {
    ui.line(`配置初始化失败：${e.message}`);
    return;
  }

  for (;;) {
    ui.header(APP);
    ui.line('  1. 从京东抓取聊天记录（已登录后台 + 调试端口）');
    ui.line('  2. 导入聊天记录（粘贴文本 / 文件）');
    ui.line('  3. 生成培训课件 HTML（聊天记录 + AI解析 → 成品 + 自检）');
    ui.line('  4. 工作区文件管理');
    ui.line('  5. 抓取与输出设置');
    ui.line('  0. 退出');
    const idx = await ui.askChoice('请选择', ['从京东抓取', '导入聊天记录', '生成课件', '文件管理', '设置']);
    if (idx < 0) { ui.line('再见。'); break; }
    if (idx === 0) await flowFetchJd(ws, cfg, ui);
    else if (idx === 1) await flowImport(ws, ui);
    else if (idx === 2) await flowGenerate(ws, ui);
    else if (idx === 3) await flowBrowse(ws, ui);
    else await flowSettings(ws, ui);
  }
}

main().catch((e) => {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});
